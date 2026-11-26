// lib/api/ads-launch.ts — '제안 전체 켜기'(3.6단계). 화면이 기존 켜기 API(/api/ads/entities/[type]/[id]/lock)를 항목마다 순서대로 부른다.
// 서버에 묶음 경로를 따로 만들지 않는 이유: 켜기 1건의 최악 시간(≈280초, lib/ads/locks.ts)이 함수 한도(300초)에 맞춰져 있어
//   여러 건을 한 함수에서 돌리면 켜기 도중 강제 종료될 수 있다. 항목별 호출은 검증된 시간 한도·안전장치(스위치·상한·대조·CAS)를 그대로 쓴다.
// 순서: 소재 → 키워드 → 광고그룹 → 캠페인(하위부터 — 상위가 꺼져 있는 동안은 노출되지 않는다. 캠페인이 마지막 노출 시점).
// - 검수 미통과(not_inspected) 키워드·소재는 실패가 아니라 건너뜀(나머지는 켠다).
// - 그 밖의 실패는 즉시 멈추고, 이번 실행에서 켠 항목을 역순으로 다시 끈다. 다시 끄지 못한 항목은 urgent로 보고한다.
//   · 켜졌는지 모르는 실패(4xx 확정 거절·서버의 '다시 껐음' 표시가 아닌 모든 것 — 응답·본문 유실, 5xx)는 그 항목도 다시 끈다(codex HIGH).
//   · 되돌리기 직전 개요를 다시 읽어(current) 버전이 내가 켠 직후 값과 다르면 다른 곳(다른 탭·감시)이 바꾼 것이라 건드리지 않는다(codex MED).
//     다시 읽지 못하면 안전 방향으로 모두 끈다. 남은 틈: 다시 읽은 뒤 끄기 전 몇 초 사이 다른 탭이 켠 것은 꺼질 수 있다(비용 위험 없는 방향).
// - 남은 위험: 실행 도중 탭을 닫으면 되돌리기도 멈춘다(서버 기록 없음). 켜진 항목은 각각 서버 켜기 검사를 통과한 것이고 지출은 감시(하루 상한)가 막는다.
// - 개요가 상한에 걸려 일부만 실렸으면(truncated) 시작하지 않는다(빠진 항목을 모른 채 켜지 않게).
import type { AdLockEntityType, AdLockResultDTO, AdMirrorBaseDTO, AdOverviewDTO } from '@/types/ads';

export type LaunchItem = { type: AdLockEntityType; id: string; naverId: string; name: string; lockVersion: number };
export type LaunchPlan = { items: LaunchItem[]; truncated: boolean };
export type LockFn = (type: AdLockEntityType, id: string, locked: boolean, lockVersion: number) => Promise<AdLockResultDTO>;
export type LaunchFailure = { item: LaunchItem; error: unknown; unknownState: boolean };
/** 되돌리기 직전 현재 버전(키 `${type}:${id}`). 없으면 확인 없이 끈다. */
export type CurrentVersions = () => Promise<ReadonlyMap<string, number>>;
export type LaunchResult = {
  turnedOn: LaunchItem[];
  skipped: LaunchItem[];
  failure: LaunchFailure | null;
  rolledBack: LaunchItem[];
  rollbackFailed: LaunchItem[];
  /** 다른 곳에서 바뀌어 되돌리지 않은 항목 */
  rollbackSkipped: LaunchItem[];
};

export const LAUNCH_ORDER: readonly AdLockEntityType[] = ['ad', 'keyword', 'adgroup', 'campaign'];
export const LAUNCH_LABEL: Readonly<Record<AdLockEntityType, string>> = { ad: '소재', keyword: '키워드', adgroup: '광고그룹', campaign: '캠페인' };

const isOff = (r: AdMirrorBaseDTO) => r.userLock || r.lockedBy !== null;

/** 이 제안에서 아직 켜지지 않은 항목(켜는 순서대로). */
export function planLaunch(o: Pick<AdOverviewDTO, 'campaigns' | 'groups' | 'keywords' | 'ads' | 'truncated'>, proposalId: string): LaunchPlan {
  const lists: Record<AdLockEntityType, AdMirrorBaseDTO[]> = { ad: o.ads, keyword: o.keywords, adgroup: o.groups, campaign: o.campaigns };
  const items = LAUNCH_ORDER.flatMap((type) => lists[type]
    .filter((r) => r.proposalId === proposalId && isOff(r))
    .map((r) => ({ type, id: r.id, naverId: r.naverId, name: r.name, lockVersion: r.lockVersion })));
  const t = o.truncated;
  return { items, truncated: t.campaigns || t.groups || t.keywords || t.ads };
}

const codeOf = (e: unknown) => (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '');
/** 켜졌는지 모르는 실패 = '확실한 실패'가 아닌 모든 것. 확실 = 서버가 4xx로 답함(켜기 전 검사에서 거절) 또는 서버가 다시 껐다고 알림(details.paused=true).
 *  응답 유실(network)·5xx·본문을 못 읽은 200(codex HIGH 2차)·켜짐 미확인(not_resumed)은 모두 모름 → 다시 끈다(끄기는 꺼진 항목에도 안전). */
export function isUnknownState(e: unknown): boolean {
  const x = (e ?? {}) as { status?: unknown; details?: { paused?: unknown } };
  if (x.details?.paused === true) return false;
  return !(typeof x.status === 'number' && x.status >= 400 && x.status < 500);
}
const keyOf = (x: Pick<LaunchItem, 'type' | 'id'>) => `${x.type}:${x.id}`;

/** 순서대로 켠다. onProgress(완료 수)는 화면 진행 표시용. */
export async function runLaunch(items: readonly LaunchItem[], lock: LockFn, onProgress?: (done: number) => void, current?: CurrentVersions): Promise<LaunchResult> {
  const result: LaunchResult = { turnedOn: [], skipped: [], failure: null, rolledBack: [], rollbackFailed: [], rollbackSkipped: [] };
  const after = new Map<string, number>(); // 내가 켠 직후 버전
  for (const [i, item] of items.entries()) {
    try {
      const stored = await lock(item.type, item.id, false, item.lockVersion);
      if (stored.userLock) throw Object.assign(new Error('네이버가 켜짐으로 바뀌지 않았습니다.'), { code: 'not_resumed' });
      after.set(keyOf(item), stored.lockVersion);
      result.turnedOn.push(item);
    } catch (error) {
      if ((item.type === 'ad' || item.type === 'keyword') && codeOf(error) === 'not_inspected') result.skipped.push(item);
      else { result.failure = { item, error, unknownState: isUnknownState(error) }; break; }
    }
    onProgress?.(i + 1);
  }
  if (!result.failure) return result;
  const now = current ? await current().catch(() => null) : null; // 못 읽으면 확인 없이 끈다(안전 방향)
  const targets = [...(result.failure.unknownState ? [result.failure.item] : []), ...[...result.turnedOn].reverse()];
  for (const item of targets) {
    const mine = after.get(keyOf(item));
    if (now && mine !== undefined && now.get(keyOf(item)) !== mine) { result.rollbackSkipped.push(item); continue; }
    try {
      await lock(item.type, item.id, true, item.lockVersion); // 끄기는 서버가 버전과 무관하게 이긴다
      result.rolledBack.push(item);
    } catch {
      result.rollbackFailed.push(item);
    }
  }
  return result;
}

const names = (xs: readonly LaunchItem[]) => xs.map((x) => `${LAUNCH_LABEL[x.type]} '${x.name}'`).join(', ');

/** 결과 문구. 다시 끄지 못한 항목이 있거나 실패 항목 자체가 urgent(켜졌는지 모르고 재끄기도 실패 — lockErrorView)면 urgent.
 *  failure = 실패 원인 문구·긴급도(화면은 lockErrorView(error, false)를 넘긴다). */
export function launchResultView(r: LaunchResult, failure: { message: string; urgent: boolean } = { message: '', urgent: false }): { message: string; urgent: boolean } {
  const failureMessage = failure.message;
  const skipped = r.skipped.length ? ` 검수가 끝나지 않은 ${r.skipped.length}개(${names(r.skipped)})는 건너뛰었습니다.` : '';
  if (!r.failure) return { message: `${r.turnedOn.length}개를 켰습니다.${skipped}`, urgent: false };
  const where = `${LAUNCH_LABEL[r.failure.item.type]} '${r.failure.item.name}'`;
  if (r.rollbackFailed.length)
    return { message: `${where} 켜기에 실패했습니다(${failureMessage}). 이번에 켠 항목 중 ${names(r.rollbackFailed)}을(를) 다시 끄지 못했습니다 — 네이버 화면에서 지금 바로 직접 꺼 주세요.`, urgent: true };
  const back = r.rolledBack.length ? ` 이번에 켠(또는 켜졌는지 모르는) ${r.rolledBack.length}개는 다시 껐습니다.` : '';
  const other = r.rollbackSkipped.length ? ` ${names(r.rollbackSkipped)}은(는) 그 사이 다른 곳에서 바뀌어 그대로 두었습니다 — 상태를 확인하세요.` : '';
  return { message: `${where} 켜기에 실패해 멈췄습니다(${failureMessage}).${back}${other}${skipped}`, urgent: failure.urgent };
}
