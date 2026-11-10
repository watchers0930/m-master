// types/ads.ts — 광고 API 응답 DTO(서버·클라이언트 공용). 키 원문·암호문은 어떤 DTO에도 없다(화면엔 keyLast4만).

export type AdAccountStatus = "active" | "invalid_key" | "disconnecting" | "disabled"; // disconnecting = 해제 진행 중(다른 모든 호출 거부)

export type AdAccountDTO = {
  id: string;
  naverCustomerId: string;
  label: string;
  /** API 키 뒤 4자리. 연결 해제(disabled)면 null */
  keyLast4: string | null;
  status: AdAccountStatus;
  /** 키가 저장돼 있고 해제되지 않음. false = "연결 안 됨"(오류 아님) */
  connected: boolean;
  dailyCapKrw: number;
  sharedBudgetKrw: number;
  maxBidKrw: number;
  sharedBudgetId: string | null;
  businessChannelId: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  /** 'disconnecting'이 10분 넘게 이어짐(죽은 해제) — 화면이 '해제 다시 시도'를 보인다(서버가 같은 DELETE로 재점유) */
  disconnectStuck: boolean;
};

export type AdChannelDTO = {
  id: string;
  name: string | null;
  url: string | null;
  pcInspectStatus: string | null;
  mobileInspectStatus: string | null;
  /** PC·모바일 검수가 모두 APPROVED|ELIGIBLE인 SITE 채널만 true */
  selectable: boolean;
};

export type AdAccountWithChannels = { account: AdAccountDTO; channels: AdChannelDTO[] };

// ── AI 광고 제안(Task 8). 계정 키·암호문은 들어가지 않는다 ──
export type AdProposalKind = "new_campaign" | "extend_group";
export type AdProposalStatus = "draft" | "pending_review" | "approved" | "rejected" | "applying" | "applied" | "apply_failed";

/** 키워드 근거 — 항상 서버가 키워드 도구 통계(KeywordStat)로 채운다(LLM·클라이언트 값은 버림). qc = PC+모바일 월간 조회수, "< 10"이면 null+lt10. */
export type ProposalEvidence = { qc: number | null; compIdx: "낮음" | "중간" | "높음" | null; lt10: boolean };
export type ProposalKeyword = { keyword: string; bidAmt: number; reason: string; evidence: ProposalEvidence };
export type ProposalCreative = { headline: string; description: string };
export type ProposalGroup = { name: string; bidAmt: number; keywords: ProposalKeyword[]; creatives: ProposalCreative[] };
export type ProposalPayload = { groups: ProposalGroup[] };

/** 남은 린트 위반 1건. group·index는 0부터. 승인은 위반 0건일 때만. */
export type ProposalLintIssue = {
  group: number;
  target: "keyword" | "creative";
  index: number;
  rule: string;
  field: "headline" | "description" | "keyword";
  message: string;
};
export type ProposalLintResult = { issues: ProposalLintIssue[]; checkedAt: string };

/** 제안 생성에 쓴 키워드 도구 통계(근거의 출처). */
export type ProposalSourceKeyword = {
  keyword: string;
  pcQc: number | null;
  mobileQc: number | null;
  lt10: boolean;
  compIdx: "낮음" | "중간" | "높음" | null;
  pcCtr: number | null;
  mobileCtr: number | null;
  plAvgDepth: number | null;
};

export type AdProposalSummaryDTO = {
  id: string;
  accountId: string;
  kind: AdProposalKind;
  targetAdgroupId: string | null;
  status: AdProposalStatus;
  groupCount: number;
  keywordCount: number;
  lintIssueCount: number;
  costKrw: number;
  createdAt: string;
  updatedAt: string;
};

export type AdProposalDTO = AdProposalSummaryDTO & {
  payload: ProposalPayload;
  lintResult: ProposalLintResult | null;
  sourceKeywords: ProposalSourceKeyword[];
  failCode: string | null;
  reviewedAt: string | null;
};

export type AdProposalPage = { items: AdProposalSummaryDTO[]; nextCursor: string | null };

// ── 적용·켜기/끄기 결과(Task 9 라우트 응답) ──
export type AdApplyResultDTO = { status: "applied" | "apply_failed"; failCode?: string };
export type AdLockEntityType = "campaign" | "adgroup" | "keyword" | "ad";
export type AdLockResultDTO = { type: AdLockEntityType; id: string; naverId: string; userLock: boolean; lockedBy: string | null; lockVersion: number };

// ── 계정 개요(Task 12, GET /api/ads/accounts/[id]/overview — DB만 읽는다, 네이버 호출 없음) ──
/** 감시(30분 크론)의 마지막 관찰. 값이 null이면 '모름'(0이 아니다). ageMinutes = 지금 − at(분, 내림, 0 이상). */
export type AdGuardSnapshotDTO = { at: string | null; ageMinutes: number | null; spendKrw: number | null; bizmoneyKrw: number | null };
/** 미러 공통. lockedBy: owner | guard | pending_launch | null(켜짐 또는 외부). lockVersion은 켜기 요청의 expected_lock_version. */
export type AdMirrorBaseDTO = {
  id: string; naverId: string; parentNaverId: string | null; name: string; proposalId: string | null;
  userLock: boolean; lockedBy: string | null; lockVersion: number; lockedAt: string | null; inspectStatus: string | null;
  /** 켜짐으로 기록됐지만 마지막 잠금 변경 뒤의 끄기가 확인되지 않음(ads.pause_failed paused:false) — '켜짐'이 아니라 '꺼지지 않았을 수 있음' */
  pauseUnconfirmed: boolean;
};
export type AdMirrorCampaignDTO = AdMirrorBaseDTO;
export type AdMirrorGroupDTO = AdMirrorBaseDTO & { bidAmt: number | null };
export type AdMirrorKeywordDTO = AdMirrorBaseDTO & { keyword: string; bidAmt: number | null };
export type AdMirrorAdDTO = AdMirrorBaseDTO & { slot: string | null; headline: string; description: string };
/** 성과 합계(/stats 기준). costKrw = salesAmt(VAT 별도), ccnt = 네이버 전환 수(4-2 전에는 0). */
export type AdPerfTotals = { impCnt: number; clkCnt: number; costKrw: number; ccnt: number };
export type AdCampaignPerfDTO = { naverId: string; days7: AdPerfTotals; days30: AdPerfTotals };
export type AdDailyPerfDTO = AdPerfTotals & { date: string };
/** 화면 경보로 보이는 안전 유형(최근 48시간, 메일 발송 여부와 무관). */
export type AdSafetyAlertType = 'ads.pause_failed' | 'ads.guard_blind' | 'ads.cap_100' | 'ads.drift' | 'ads.inspect_denied';
/** 안전 경보 1건(알림 payload에서 알려진 필드만). sent = 메일 발송됨. */
export type AdSafetyAlertDTO = {
  type: AdSafetyAlertType; at: string; sent: boolean;
  reason: string | null; entity: string | null; naverId: string | null; field: string | null; paused: boolean | null; pauseFailed: number | null;
};
export type AdOverviewDTO = {
  account: AdAccountDTO;
  snapshot: AdGuardSnapshotDTO;
  /** 최근 48시간 안전 경보(최신순, 최대 OVERVIEW_ALERT_LIMIT건) */
  alerts: AdSafetyAlertDTO[];
  campaigns: AdMirrorCampaignDTO[];
  groups: AdMirrorGroupDTO[];
  keywords: AdMirrorKeywordDTO[];
  ads: AdMirrorAdDTO[];
  /** 상한(take)에 걸려 일부만 실었는가 */
  truncated: { campaigns: boolean; groups: boolean; keywords: boolean; ads: boolean };
  /** since7·since30 = 창의 첫 KST 날짜(오늘 포함 7일·30일). daily = 30일 창의 날짜별 합계(행 있는 날만, 오름차순). */
  performance: { since7: string; since30: string; campaigns: AdCampaignPerfDTO[]; daily: AdDailyPerfDTO[]; totals7: AdPerfTotals; totals30: AdPerfTotals };
};
