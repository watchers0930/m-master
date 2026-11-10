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
