// lib/api/ads-safety.ts — 광고 화면 안전 표시 규칙(순수 함수, 최종 판정 B1~B4). 감시·끄기가 실패한 사실을 화면에서 놓치지 않게 한다.
// - safetyNotices: 개요의 최근 48시간 안전 경보(메일 발송 여부와 무관) → 페이지 배너 문구. 끄기 실패·감시 불가는 urgent.
// - alertBadges: 엔티티(naverId)별 경보 꼬리표.
// - lockErrorView: 끄기 요청의 실패는 원인과 무관하게 urgent(끄기는 지금 바로 직접 확인해야 한다). 켜기 실패는 재끄기 실패일 때 urgent.
// - disconnectingView: 해제 중 계정 경고(10분 넘게 멈추면 urgent + '해제 다시 시도').
import type { AdAccountDTO, AdGuardSnapshotDTO, AdSafetyAlertDTO } from '@/types/ads';
import { errorView, failCodeMessage, snapshotAgeLabel, type ErrorView } from './ads-format';

/** 감시 크론은 30분마다 돈다. 이보다 오래 기록이 없으면 '감시 멈춤' 경고. */
export const GUARD_STALE_MINUTES = 90;
export const MAX_NOTICES = 8;
const ACT_NOW = '네이버 화면에서 지금 바로 직접 꺼 주세요';
const CHECK_NAVER = '네이버 화면에서 오늘 비용과 켜진 캠페인을 직접 확인하세요';

export type SafetyNotice = { message: string; urgent: boolean };

const ENTITY: Readonly<Record<string, string>> = { campaign: '캠페인', adgroup: '광고그룹', keyword: '키워드', ad: '소재', sharedBudget: '공유예산' };
const target = (a: AdSafetyAlertDTO) => [a.entity ? ENTITY[a.entity] ?? a.entity : '', a.naverId ?? ''].filter(Boolean).join(' ');

const BLIND: Readonly<Record<string, string>> = {
  spend_unknown: '감시가 오늘 비용을 확인하지 못했습니다',
  deadline: '감시가 시간 안에 모든 항목을 확인하지 못했습니다',
  campaign_list_incomplete: '감시가 캠페인 목록을 끝까지 읽지 못했습니다',
  credential_unavailable: '감시가 저장된 광고 키를 쓸 수 없습니다',
  client_unavailable: '감시가 네이버 연결을 만들지 못했습니다',
  guard_error: '감시 중 알 수 없는 오류가 났습니다',
  disconnect_stuck: '연결 해제가 10분 넘게 멈췄습니다 — 감시는 비용 측정·상한 끄기만 합니다',
  scan_truncated: '감시가 설정 드리프트 검사를 끝까지 하지 못했습니다',
};

function noticeOf(a: AdSafetyAlertDTO): SafetyNotice {
  const where = target(a);
  switch (a.type) {
    case 'ads.pause_failed':
      return a.paused === false
        ? { message: `끄기를 확인하지 못했습니다${where ? `(${where})` : ''} — ${ACT_NOW}.`, urgent: true }
        : { message: `켜는 도중 계정 상태가 바뀌어 다시 껐습니다${where ? `(${where})` : ''}. 상태를 확인하세요.`, urgent: false };
    case 'ads.guard_blind':
      return { message: `${BLIND[a.reason ?? ''] ?? `감시가 이 계정을 보지 못했습니다(${a.reason ?? '사유 없음'})`} — ${CHECK_NAVER}.`, urgent: true };
    case 'ads.cap_100':
      return (a.pauseFailed ?? 0) > 0
        ? { message: `하루 상한에 도달해 캠페인을 껐지만 ${a.pauseFailed}개는 끄지 못했습니다 — ${ACT_NOW}.`, urgent: true }
        : { message: '하루 상한에 도달해 켜진 캠페인을 모두 껐습니다. 내일 0시(KST)에 감시가 다시 켭니다.', urgent: false };
    case 'ads.drift':
      return { message: `네이버 설정이 MINTEQ 기록과 다릅니다${where ? `(${where})` : ''}${a.field ? ` · 항목 ${a.field}` : ''}${a.paused ? ' — 켜져 있어 껐습니다' : ''}. 네이버 화면에서 설정을 확인하세요.`, urgent: false };
    case 'ads.inspect_denied':
      return { message: `광고 검수가 반려됐습니다${where ? `(${where})` : ''}. 문구를 고친 새 제안으로 진행하세요.`, urgent: false };
  }
}

/** 페이지 배너 문구(경보 최신순 그대로, 최대 MAX_NOTICES + 나머지 1줄). 감시 스냅샷이 오래됐으면 맨 앞에 경고. */
export function safetyNotices(alerts: AdSafetyAlertDTO[], snapshot: AdGuardSnapshotDTO): SafetyNotice[] {
  const out: SafetyNotice[] = [];
  if (snapshot.ageMinutes === null) out.push({ message: '감시 기록이 아직 없습니다. 감시가 30분마다 오늘 비용을 확인합니다.', urgent: false });
  else if (snapshot.ageMinutes > GUARD_STALE_MINUTES)
    out.push({ message: `감시가 ${snapshotAgeLabel(snapshot.ageMinutes).replace(' 기준', '')} 이후 기록을 남기지 않았습니다 — 감시가 멈췄을 수 있습니다. ${CHECK_NAVER}.`, urgent: true });
  for (const a of alerts.slice(0, MAX_NOTICES)) {
    const n = noticeOf(a);
    out.push(a.sent ? n : { ...n, message: `${n.message} · 메일 미발송` });
  }
  if (alerts.length > MAX_NOTICES) out.push({ message: `그 밖의 경보 ${alerts.length - MAX_NOTICES}건이 더 있습니다(최근 48시간).`, urgent: false });
  return out;
}

export type AlertBadge = { text: string; urgent: boolean };
const BADGE: Readonly<Partial<Record<AdSafetyAlertDTO['type'], AlertBadge>>> = {
  'ads.drift': { text: '설정 드리프트', urgent: false },
  'ads.inspect_denied': { text: '검수 반려', urgent: false },
};

/** naverId → 꼬리표(같은 종류는 1개, urgent 먼저). 끄기 미확인(pause_failed paused:false)은 urgent. */
export function alertBadges(alerts: AdSafetyAlertDTO[]): Map<string, AlertBadge[]> {
  const out = new Map<string, AlertBadge[]>();
  for (const a of alerts) {
    if (!a.naverId) continue;
    const badge = a.type === 'ads.pause_failed' ? (a.paused === false ? { text: '끄기 미확인', urgent: true } : null) : BADGE[a.type] ?? null;
    if (!badge) continue;
    const list = out.get(a.naverId) ?? [];
    if (!list.some((b) => b.text === badge.text)) list.push(badge);
    out.set(a.naverId, list.sort((x, y) => Number(y.urgent) - Number(x.urgent)));
  }
  return out;
}

/** 켜기·끄기 실패 문구. locked=true(끄기)면 무엇이든 urgent. */
export function lockErrorView(error: unknown, locked: boolean): ErrorView {
  const base = errorView(error);
  const e = (error ?? {}) as { code?: unknown; details?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (locked) {
    if (code === 'keys_removed') return { ...base, urgent: true };
    return { message: `끄기를 확인하지 못했습니다 — ${ACT_NOW}.`, urgent: true, reload: true };
  }
  const paused = e.details && typeof e.details === 'object' ? (e.details as Record<string, unknown>).paused : undefined;
  if (code === 'spend_unknown') return { message: failCodeMessage('launch_spend_unknown') ?? base.message, urgent: false, reload: true }; // 재검토 I-1
  if ((code === 'resume_race' || code === 'ads_uncertain') && paused === false)
    return { message: `켜는 도중 문제가 생겼고 다시 끄지도 못했습니다 — ${ACT_NOW}.`, urgent: true, reload: true };
  return base;
}

/** 해제 중 계정 안내(아니면 null). */
export function disconnectingView(account: Pick<AdAccountDTO, 'status' | 'disconnectStuck'>): ErrorView | null {
  if (account.status !== 'disconnecting') return null;
  if (account.disconnectStuck)
    return { message: `연결 해제가 10분 넘게 멈췄습니다. 일부 캠페인이 켜져 있을 수 있습니다 — 감시는 비용 측정·상한 끄기만 합니다. '해제 다시 시도'를 누르거나 ${CHECK_NAVER}.`, urgent: true, reload: false };
  return { message: '연결 해제가 진행 중입니다(모든 캠페인을 끄고 확인하는 중). 끝날 때까지 감시는 비용 측정·상한 끄기만 합니다.', urgent: false, reload: false };
}
