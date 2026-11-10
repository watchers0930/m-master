// lib/ads/verify-stored.ts — 쓰기 후 재조회 검증(설계서 §5.4-2). '보낸 값'이 아니라 '네이버에 저장된 값'으로 상한을 보장한다.
// - stored(unknown)는 zod로 parse한다. 추가 필드는 버리고(strip), 필수 필드 누락·타입 불일치는 {ok:false, field:'shape'}.
// - 어떤 실패(형태·계정 값 포함)도 ok:true가 될 수 없다. AdsInvariantError가 아닌 예외는 삼키지 않고 다시 던진다.
import { z } from "zod";
import {
  AdsInvariantError, NEUTRAL_BID_WEIGHT, caps, checkBid, checkDailyBudget, fail, requireText,
  type Caps, type CapAccount, type CreateKind,
} from "./invariants";

export type StoredKind = Exclude<CreateKind, "ad">;
export type VerifyResult = { ok: true } | { ok: false; field: string };

const int = z.number().int();
const STORED_SCHEMAS = {
  // 공유예산 해제 시 네이버는 sharedBudgetId·sharedDailyBudget을 null로 준다 → 원인 필드명으로 판정
  campaign: z.object({
    sharedBudgetId: z.string().nullable(),
    sharedDailyBudget: int.nullable().optional(),
    useDailyBudget: z.boolean(),
    dailyBudget: int,
  }),
  // 입찰배수·자동입찰·그룹 공유예산은 응답에 없으면 허용, 있으면 위험값을 판정
  adgroup: z.object({
    aiAdsOptIn: z.boolean(),
    useExpSearch: z.boolean(),
    useDailyBudget: z.boolean(),
    dailyBudget: int,
    bidAmt: int,
    pcNetworkBidWeight: int.optional(),
    mobileNetworkBidWeight: int.optional(),
    useCntsNetworkBidAmt: z.boolean().optional(),
    systemBiddingType: z.string().optional(),
    sharedBudgetId: z.string().nullable().optional(),
  }),
  keyword: z.object({ useGroupBidAmt: z.boolean(), bidAmt: int }),
  // status는 응답에 없으면 허용(다른 검사로 판정), DELETED면 1층 상한이 사라진 것이다(최종 판정 A5)
  sharedBudget: z.object({ sharedBudgetId: z.string(), ownerType: z.string(), dailyBudget: int, status: z.string().nullable().optional() }),
} as const;

type Parsed<K extends StoredKind> = z.infer<(typeof STORED_SCHEMAS)[K]>;

function checkCampaign(s: Parsed<"campaign">, a: CapAccount, c: Caps): void {
  if (s.sharedBudgetId !== requireText(a.sharedBudgetId, "sharedBudgetId")) fail("sharedBudgetId");
  if (s.useDailyBudget !== true) fail("useDailyBudget");
  checkDailyBudget(s.dailyBudget, c);
  // 계정 전체 상한을 실제로 지키는 것은 연결된 공유예산 금액이다
  if (s.sharedDailyBudget === undefined || s.sharedDailyBudget === null) fail("shape");
  checkDailyBudget(s.sharedDailyBudget, c, "sharedDailyBudget");
}

function checkAdgroup(s: Parsed<"adgroup">, c: Caps): void {
  if (s.aiAdsOptIn !== false) fail("aiAdsOptIn");
  if (s.useExpSearch !== false) fail("useExpSearch");
  if (s.useDailyBudget !== true) fail("useDailyBudget");
  checkDailyBudget(s.dailyBudget, c);
  checkBid(s.bidAmt, c);
  // 실효 입찰 = bidAmt × weight/100. 100 초과면 maxBid 상한이 우회된다
  if (s.pcNetworkBidWeight !== undefined && s.pcNetworkBidWeight > NEUTRAL_BID_WEIGHT) fail("pcNetworkBidWeight");
  if (s.mobileNetworkBidWeight !== undefined && s.mobileNetworkBidWeight > NEUTRAL_BID_WEIGHT) fail("mobileNetworkBidWeight");
  if (s.useCntsNetworkBidAmt === true) fail("useCntsNetworkBidAmt");
  if (s.systemBiddingType !== undefined && s.systemBiddingType !== "NONE") fail("systemBiddingType");
  if (s.sharedBudgetId !== undefined && s.sharedBudgetId !== null) fail("sharedBudgetId");
}

function checkSharedBudget(s: Parsed<"sharedBudget">, a: CapAccount, c: Caps): void {
  if (s.sharedBudgetId !== requireText(a.sharedBudgetId, "sharedBudgetId")) fail("sharedBudgetId");
  if (s.ownerType !== "CAMPAIGN") fail("ownerType");
  if (s.status === "DELETED") fail("status");
  checkDailyBudget(s.dailyBudget, c);
}

function checkStored(kind: StoredKind, a: CapAccount, c: Caps, stored: unknown): void {
  switch (kind) {
    case "campaign": {
      const p = STORED_SCHEMAS.campaign.safeParse(stored);
      return p.success ? checkCampaign(p.data, a, c) : fail("shape");
    }
    case "adgroup": {
      const p = STORED_SCHEMAS.adgroup.safeParse(stored);
      return p.success ? checkAdgroup(p.data, c) : fail("shape");
    }
    case "keyword": {
      const p = STORED_SCHEMAS.keyword.safeParse(stored);
      if (!p.success) fail("shape");
      if (p.data.useGroupBidAmt === false) checkBid(p.data.bidAmt, c); // 그룹 입찰이면 그룹 bidAmt가 상한을 지킨다
      return;
    }
    case "sharedBudget": {
      const p = STORED_SCHEMAS.sharedBudget.safeParse(stored);
      return p.success ? checkSharedBudget(p.data, a, c) : fail("shape");
    }
  }
}

/** 쓰기 직후 네이버에 '실제로 저장된 값'을 대조한다. ok:true는 모든 검사를 통과한 경우뿐이다. */
export function verifyStored(kind: StoredKind, account: CapAccount, stored: unknown): VerifyResult {
  if (typeof kind !== "string" || !Object.hasOwn(STORED_SCHEMAS, kind)) return { ok: false, field: "kind" };
  try {
    checkStored(kind, account, caps(account), stored);
    return { ok: true };
  } catch (e) {
    if (e instanceof AdsInvariantError) return { ok: false, field: e.field };
    throw e;
  }
}
