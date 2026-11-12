// lib/api/ads-format.ts — 광고 화면 표시 규칙(순수 함수, Task 12). failCode·오류 코드 → 한국어, 금액·나이·전환 비용, 잠금·검수 표시, 씨앗 입력.
// 문구 출처: task-12-carry.md(Task 5~11 판정). 서버가 이미 한국어 문구를 주는 오류는 그대로 쓰고, 화면 행동이 달라야 하는 것만 바꾼다.
import type { AdChannelDTO, AdProposalStatus, EstimatePosition, ExpectedPosition, PositionBidTable, ProposalLintIssue } from '@/types/ads';

/** 서버 schemas/ads-proposal.ts MAX_MANUAL_SEEDS·MAX_MANUAL_SEED_LENGTH와 같다(서버도 검사한다). */
export const MAX_SEEDS = 25;
export const MAX_SEED_LENGTH = 40;

const FIXED_FAIL: Readonly<Record<string, string>> = {
  target_active: '확장할 광고그룹이나 그 캠페인이 켜져 있습니다. 네이버에서 먼저 끈 뒤 적용하세요(4-1 제한 — 새 소재가 바로 노출되지 않게).',
  cap_reached: '오늘 하루 상한에 도달해 진행하지 않았습니다. 내일 다시 시도하세요.',
  spend_unknown: '오늘 광고비를 확인하지 못해 상한을 지킬 수 없어 진행하지 않았습니다. 잠시 후 다시 시도하세요.',
  // 켜기(잠금 해제)의 spend_unknown(재검토 I-1): 활동 없는 계정은 /stats가 비어 있어 오늘 만든·켠 캠페인이 있으면 비용을 모른다
  launch_spend_unknown: '오늘 광고비를 확인하지 못해 켜지 않았습니다(하루 상한을 지킬 수 없음). 적용한 날에는 켤 수 없습니다 — 적용 다음 날(KST) 이후에 아래에서부터 켜세요: 소재 → 키워드 → 그룹 → 캠페인(마지막). 캠페인을 먼저 켰다면 끄고 다음 날 이 순서로 다시 켜세요.',
  guard_locked: '오늘 하루 상한으로 감시가 멈춘 항목입니다. 내일 0시(KST)에 자동으로 다시 켜집니다.',
  ads_paused: '광고 실행이 비상 정지 상태입니다. 끄기와 조회만 할 수 있습니다.',
  ads_not_connected: '연결되지 않았거나 키가 무효인 광고 계정입니다. 계정 화면에서 키를 확인하세요.',
  ads_account_not_ready: '광고 계정이 활성 상태이고 비즈채널이 선택돼 있어야 적용할 수 있습니다.',
  target_adgroup_deleted: '확장할 광고그룹이 네이버에서 삭제됐습니다. 새 제안으로 진행하세요.',
  target_adgroup_missing: '확장할 광고그룹을 MINTEQ 기록에서 찾지 못했습니다.',
  internal_error: '처리 중 알 수 없는 오류로 멈췄습니다. 네이버 화면에서 생성된 항목이 있는지 확인하세요.',
  ads_auth_failed: '네이버 API 키가 더 이상 유효하지 않습니다. 계정 화면에서 새 키로 교체하세요.',
  ads_forbidden: '이 광고 계정 리소스에 접근할 권한이 없습니다.',
  ads_rate_limited: '네이버 호출 한도에 걸렸습니다. 잠시 후 다시 적용하세요(이어서 진행합니다).',
  ads_unavailable: '네이버 광고 API에 연결하지 못했습니다. 잠시 후 다시 적용하세요(이어서 진행합니다).',
};

/** 적용 실패 코드(AdProposal.failCode, 적용 응답 failCode) → 한국어. */
export function failCodeMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  const [kind, ...rest] = code.split(':');
  const detail = rest.join(':');
  switch (kind) {
    case 'uncertain': return `네이버에 생성됐는지 확인되지 않음 — 네이버 화면 확인 후 새 제안으로 진행 (단계 ${detail})`;
    case 'pause_failed': return `만든 항목을 끄지 못했습니다 — 즉시 네이버 화면에서 직접 꺼 주세요 (단계 ${detail})`;
    case 'ambiguous': return `네이버에 같은 이름의 항목이 여러 개라 판단하지 못했습니다 — 네이버 화면 확인 후 정리하세요 (단계 ${detail})`;
    case 'drift': return `네이버 설정이 MINTEQ 상한과 다릅니다(${detail}). 네이버 화면에서 설정을 확인하세요.`;
    case 'lint': return `등록 기준 위반(${detail})으로 네이버가 거절했습니다. 문구를 고친 새 제안으로 진행하세요.`;
    case 'rejected': return `네이버가 요청을 거절했습니다(코드 ${detail}).`;
    case 'invariant': return `광고 상한 규칙을 지키지 못하는 값입니다(${detail}).`;
  }
  return FIXED_FAIL[code] ?? `적용 실패(${code})`;
}

/** 대장이 지금 네이버 화면에서 직접 확인·조치해야 하는 실패. */
export const isUrgentFailCode = (code: string | null | undefined) => !!code && /^(pause_failed|uncertain|ambiguous):/.test(code);

export type AdsErrorLike = { code?: unknown; message?: unknown; status?: unknown; details?: unknown };
export type ErrorView = { message: string; urgent: boolean; reload: boolean };

/** API 오류 → 화면 문구. urgent = 붉은 경고로 크게, reload = 최신 상태를 다시 불러와야 함. */
export function errorView(error: unknown): ErrorView {
  const e = (error ?? {}) as AdsErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const serverMessage = typeof e.message === 'string' && e.message && code ? e.message : '';
  const details = (e.details && typeof e.details === 'object' ? e.details : {}) as Record<string, unknown>;
  const view = (message: string, urgent = false, reload = false): ErrorView => ({ message, urgent, reload });
  switch (code) {
    case 'pause_unconfirmed':
      return view('끄기를 확인하지 못했습니다. 네이버 화면에서 지금 바로 직접 꺼 주세요.', true, true);
    case 'keys_removed':
      return view(serverMessage || '키가 삭제된 계정입니다. 네이버 광고 화면에서 직접 꺼 주세요.', true);
    case 'budget_exceeded':
      return view('월 예산 한도 초과. 설정에서 한도를 조정하세요.');
    case 'version_conflict':
      return view('다른 곳에서 바뀌어 최신 내용으로 다시 불러왔습니다. 확인 후 다시 진행하세요.', false, true);
    case 'lock_race':
      return view(serverMessage || '켜는 도중 감시가 이 항목을 잠갔습니다. 상태를 확인하세요.', false, true);
    case 'disconnect_incomplete': {
      const n = typeof details.unconfirmedCampaigns === 'number' ? details.unconfirmedCampaigns : 1;
      return view(`캠페인 ${n}개가 꺼진 것을 확인하지 못해 해제를 중단했습니다. 키는 그대로 유지되고 감시도 계속됩니다. 잠시 후 다시 시도하세요.`, true);
    }
    case 'drift':
      return view(`${serverMessage || '네이버 설정이 MINTEQ 상한과 다릅니다.'}${typeof details.field === 'string' ? ` (항목: ${details.field})` : ''}`, false, true);
    case 'ads_invariant':
    case 'proposal_invalid':
      return view(`${serverMessage || '입력값이 규칙에 맞지 않습니다.'}${typeof details.field === 'string' ? ` (위치: ${details.field})` : ''}`);
  }
  if (FIXED_FAIL[code] && !serverMessage) return view(FIXED_FAIL[code]);
  return view(serverMessage || '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
}

// ── 금액·지표 ──
export const formatKrw = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toLocaleString('ko-KR')}원` : '확인 못 함');
export const formatCount = (n: number) => n.toLocaleString('ko-KR');
/** 제안 입찰 허용 범위(서버 DTO bidRange). 화면은 계산하지 않고 받은 값만 보여 준다. */
export const bidRangeLabel = (range: { min: number; max: number } | null) =>
  (range ? `허용 ${formatCount(range.min)}~${formatCount(range.max)}원` : '허용 범위 확인 못 함');

export function snapshotAgeLabel(ageMinutes: number | null): string {
  if (ageMinutes === null) return '감시 기록 없음';
  if (ageMinutes < 1) return '방금 전 기준';
  if (ageMinutes < 60) return `${ageMinutes}분 전 기준`;
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 24) return `${hours}시간 ${ageMinutes % 60}분 전 기준`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간 전 기준`;
}

/** 가입당 비용. 4-2(전환 추적) 전에는 ccnt가 0이라 0원·∞ 대신 안내 문구. */
export const costPerSignup = (costKrw: number, ccnt: number) => (ccnt > 0 ? formatKrw(Math.round(costKrw / ccnt)) : '전환 추적 준비 전(4-2)');
export const capPercent = (spend: number | null, cap: number) => (spend === null || cap <= 0 ? null : Math.round((spend / cap) * 100));
export const ctr = (clicks: number, impressions: number) => (impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : '—');

// ── 잠금·검수 ──
export type LockTone = 'on' | 'off' | 'guard' | 'pending' | 'danger';
/** pauseUnconfirmed: 켜짐 기록인데 마지막 끄기가 확인되지 않음(개요 DTO) → 녹색 '켜짐'이 아니라 붉은 경고(최종 판정 B1). */
export function lockLabel(userLock: boolean, lockedBy: string | null, pauseUnconfirmed = false): { text: string; tone: LockTone } {
  if (!userLock && pauseUnconfirmed) return { text: '꺼지지 않았을 수 있음 — 네이버에서 직접 확인', tone: 'danger' };
  if (!userLock) return { text: '켜짐', tone: 'on' };
  if (lockedBy === 'guard') return { text: '꺼짐 · 감시(하루 상한)', tone: 'guard' };
  if (lockedBy === 'pending_launch') return { text: '꺼짐 · 켜기 전(적용 직후)', tone: 'pending' };
  if (lockedBy === 'owner') return { text: '꺼짐 · 대장이 끔', tone: 'off' };
  return { text: '꺼짐', tone: 'off' };
}

const INSPECT: Readonly<Record<string, string>> = {
  APPROVED: '승인', ELIGIBLE: '노출 가능', UNDER_REVIEW: '검수 중', PENDING: '검수 대기', REJECTED: '반려', LIMITED_ELIGIBLE: '제한 노출',
};
export const inspectLabel = (s: string | null | undefined) => (s ? INSPECT[s] ?? s : '—');
export const isInspectPassed = (s: string | null | undefined) => s === 'APPROVED' || s === 'ELIGIBLE';

/** 고를 수 없는 비즈채널의 안내(고를 수 있으면 null). */
export function channelNote(c: Pick<AdChannelDTO, 'selectable' | 'pcInspectStatus' | 'mobileInspectStatus'>): string | null {
  if (c.selectable) return null;
  return `검수 중(PC ${inspectLabel(c.pcInspectStatus)} · 모바일 ${inspectLabel(c.mobileInspectStatus)}) — 승인 후 선택할 수 있습니다`;
}

// ── 제안 ──
const STATUS: Readonly<Record<AdProposalStatus, string>> = {
  draft: '초안', pending_review: '검토 대기', approved: '승인됨', rejected: '반려됨', applying: '적용 중', applied: '적용됨', apply_failed: '적용 실패',
};
export const proposalStatusLabel = (s: string) => STATUS[s as AdProposalStatus] ?? s;

export function issuesFor(issues: ProposalLintIssue[], group: number, target: ProposalLintIssue['target'], index: number, field?: ProposalLintIssue['field']) {
  return issues.filter((i) => i.group === group && i.target === target && i.index === index && (field === undefined || i.field === field));
}

/** 수동 씨앗: 쉼표·줄바꿈으로 나누고 다듬어 중복 제거. 개수·길이 위반이면 error(서버와 같은 문구). */
export function parseSeeds(text: string): { seeds: string[]; error: string | null } {
  const seeds = [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
  if (seeds.length > MAX_SEEDS) return { seeds, error: '씨앗 키워드는 25개 이하입니다.' };
  if (seeds.some((s) => s.length > MAX_SEED_LENGTH)) return { seeds, error: '씨앗 키워드는 40자 이하입니다.' };
  return { seeds, error: null };
}

// ── 순위별 예상 입찰가(B4) ──
type BidRange = { min: number; max: number } | null;
/** 입찰가가 서버 허용 범위(DTO bidRange.max)를 넘는가 — 화면의 '상한 초과' 판정은 모두 이 함수 하나로 한다(천장은 계산하지 않는다). */
export const exceedsBidRange = (bid: number, range: BidRange) => range !== null && bid > range.max;

/** '약 N위' · '6위 이하' · '확인 못 함'. */
export const expectedPositionLabel = (p: ExpectedPosition) => (p === null ? '확인 못 함' : typeof p === 'number' ? `약 ${p}위` : p);

/** 'PC 약 4위 · 모바일 약 3위'. */
export const expectedSummary = (expected: { PC: ExpectedPosition; MOBILE: ExpectedPosition }) =>
  `PC ${expectedPositionLabel(expected.PC)} · 모바일 ${expectedPositionLabel(expected.MOBILE)}`;

const POSITIONS: readonly EstimatePosition[] = [1, 2, 3, 4, 5];
/** '1위 1,350원(상한 초과) · 2위 900원 · 3위 —' — 네이버가 주지 않은 순위는 '—'. */
export function positionBidsLabel(table: PositionBidTable, range: BidRange): string {
  return POSITIONS.map((p) => {
    const bid = table[p];
    if (bid === undefined) return `${p}위 —`;
    return `${p}위 ${formatKrw(bid)}${exceedsBidRange(bid, range) ? '(상한 초과)' : ''}`;
  }).join(' · ');
}
