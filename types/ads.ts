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
