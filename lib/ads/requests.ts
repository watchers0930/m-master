// lib/ads/requests.ts — 네이버 검색광고 변이 요청 빌더(설계서 §5.4-2). 모든 생성·끄기·켜기 본문은 여기서만 만든다.
// - 네이버의 위험한 기본값(§3: useDailyBudget=false, aiAdsOptIn=true, 확장검색 비율 100%)을 끄는 값을 항상 명시한다.
// - 광고그룹은 입찰배수 100·컨텐츠 별도입찰 off·자동입찰 NONE도 명시한다(실효 입찰 ≤ maxBid).
// - 호출자는 안전 필드를 약화할 수 없다: 강제값과 다른 값을 선언하면 AdsInvariantError(field). 일반 passthrough 없음.
// - 캠페인 하루 예산도 공유예산과 별도로 항상 건다. 둘의 동시 적용 여부가 명세에 없어서(⚠️) 어느 쪽에도 의존하지 않기 위함.
//   캠페인 생성 본문에는 sharedBudgetId가 없다(핫픽스 2026-11-11): 공유예산은 첫 캠페인과 함께 만들고(campaignList), 그 뒤 캠페인은 붙이기 본문으로 붙인다.
// - 수정은 GET 응답을 통째로 되돌려 보내지 않는다. 끄기/켜기는 PUT ?fields=userLock + buildPause/buildResume 최소 본문.
import {
  LOCK_ID_FIELDS, NEUTRAL_BID_WEIGHT, SHARED_BUDGET_NAME, assertInvariants, caps, checkBid, checkDailyBudget, checkUrl, customerIdOf, fail, isObj,
  requireName, requireText, type CapAccount, type LockKind, type Obj,
} from "./invariants";

export {
  AdsInvariantError, DAILY_CAP_CEILING_KRW, LOCK_ID_FIELDS, MAX_BID_KRW, MIN_BID_KRW, NEUTRAL_BID_WEIGHT, SHARED_BUDGET_NAME, assertInvariants,
  type AdsRequestKind, type CapAccount, type CreateKind, type LockKind,
} from "./invariants";
export { verifyStored, type StoredKind, type VerifyResult } from "./verify-stored";
// 안전 필드를 '같은 값으로' 명시만 할 수 있다. 다른 값·알 수 없는 키는 예외.
export type SafetyDeclaration = Readonly<Record<string, unknown>>;
export type ResumeReason = "owner_approved" | "guard_auto_resume";
const RESUME_REASONS: readonly string[] = ["owner_approved", "guard_auto_resume"];

export type SharedBudgetCampaign = { nccCampaignId: string; customerId: number; name: string; campaignTp: "WEB_SITE" };
export type SharedBudgetBody = {
  customerId: number; name: string; ownerType: "CAMPAIGN"; deliveryMethod: "ACCELERATED"; dailyBudget: number; campaignList: [SharedBudgetCampaign];
};
export type SharedBudgetAttachBody = {
  nccCampaignId: string; customerId: number; sharedBudgetId: string; sharedDailyBudget: number; sharedBudgetName: string;
};
export type CampaignBody = { customerId: number; name: string; campaignTp: "WEB_SITE"; useDailyBudget: true; dailyBudget: number; userLock: true };
export type AdgroupBody = {
  nccCampaignId: string; name: string; adgroupType: "WEB_SITE"; pcChannelId: string; mobileChannelId: string; bidAmt: number;
  pcNetworkBidWeight: 100; mobileNetworkBidWeight: 100; useCntsNetworkBidAmt: false; systemBiddingType: "NONE";
  useDailyBudget: true; dailyBudget: number; aiAdsOptIn: false; useExpSearch: false; userLock: true;
};
export type KeywordItem = { keyword: string; bidAmt: number; useGroupBidAmt: false; userLock: true };
// 명세: POST /ncc/keywords?nccAdgroupId=… , 본문은 KeywordRequest 배열(nccAdgroupId는 #hidden-create)
export type KeywordCreate = { query: { nccAdgroupId: string }; body: [KeywordItem] };
export type TextAdInput = { headline: string; description: string; pcUrl: string; mobileUrl: string };
export type TextAdBody = {
  nccAdgroupId: string; type: "TEXT_45"; userLock: true;
  ad: { headline: string; description: string; pc: { final: string }; mobile: { final: string } };
};
export type LockBody = Record<string, string | boolean>;

function declare(body: Obj, declared: SafetyDeclaration | undefined, allowed: readonly string[]): void {
  if (declared === undefined) return;
  if (!isObj(declared)) fail("declared");
  for (const key of Object.keys(declared)) {
    if (!allowed.includes(key) || !Object.is(declared[key], body[key])) fail(key);
  }
}

/** 공유예산 mq-cap 생성 본문(POST /ncc/shared-budgets). 네이버는 같은 유형 캠페인 1개 이상과 deliveryMethod를 요구한다(#834·#962) — 첫 적용의 캠페인을 싣는다. */
export function buildSharedBudget(account: CapAccount, campaign: { nccCampaignId: string; name: string }): SharedBudgetBody {
  const c = caps(account);
  const customerId = customerIdOf(account);
  if (!isObj(campaign)) fail("campaign");
  const item: SharedBudgetCampaign = {
    nccCampaignId: requireText(campaign.nccCampaignId, "nccCampaignId"), customerId, name: requireName(campaign.name, "name"), campaignTp: "WEB_SITE",
  };
  const body: SharedBudgetBody = {
    customerId, name: SHARED_BUDGET_NAME, ownerType: "CAMPAIGN", deliveryMethod: "ACCELERATED", dailyBudget: c.budget, campaignList: [item],
  };
  assertInvariants("sharedBudget", account, body);
  return body;
}

/** 기존 공유예산(계정의 sharedBudgetId)에 캠페인 붙이기 본문(PUT /ncc/campaigns/{id}?fields=sharedBudget, #962 최소 본문).
 *  금액은 재조회로 검증한 공유예산의 저장 금액(≤ 상한) — 대장이 낮춘 금액을 올리지 않는다. */
export function buildSharedBudgetAttach(account: CapAccount, campaignId: string, sharedDailyBudget: number): SharedBudgetAttachBody {
  const c = caps(account);
  checkDailyBudget(sharedDailyBudget, c, "sharedDailyBudget");
  const body: SharedBudgetAttachBody = {
    nccCampaignId: requireText(campaignId, "nccCampaignId"), customerId: customerIdOf(account),
    sharedBudgetId: requireText(account.sharedBudgetId, "sharedBudgetId"), sharedDailyBudget, sharedBudgetName: SHARED_BUDGET_NAME,
  };
  assertInvariants("sharedBudgetAttach", account, body);
  return body;
}

export function buildCampaign(account: CapAccount, name: string, declared?: SafetyDeclaration): CampaignBody {
  const c = caps(account);
  const body: CampaignBody = {
    customerId: customerIdOf(account),
    name: requireName(name, "name"),
    campaignTp: "WEB_SITE",
    useDailyBudget: true,
    dailyBudget: c.budget,
    userLock: true,
  };
  declare(body, declared, ["useDailyBudget", "dailyBudget", "userLock"]);
  assertInvariants("campaign", account, body);
  return body;
}

export function buildAdgroup(account: CapAccount, campaignId: string, name: string, bidAmt: number, declared?: SafetyDeclaration): AdgroupBody {
  const c = caps(account);
  const channel = requireText(account.businessChannelId, "businessChannelId");
  const body: AdgroupBody = {
    nccCampaignId: requireText(campaignId, "nccCampaignId"),
    name: requireName(name, "name"),
    adgroupType: "WEB_SITE",
    pcChannelId: channel,
    mobileChannelId: channel,
    bidAmt: checkBid(bidAmt, c),
    pcNetworkBidWeight: NEUTRAL_BID_WEIGHT,
    mobileNetworkBidWeight: NEUTRAL_BID_WEIGHT,
    useCntsNetworkBidAmt: false,
    systemBiddingType: "NONE",
    useDailyBudget: true,
    dailyBudget: c.budget,
    aiAdsOptIn: false,
    useExpSearch: false,
    userLock: true,
  };
  declare(body, declared, [
    "aiAdsOptIn", "useExpSearch", "useDailyBudget", "dailyBudget", "userLock",
    "pcNetworkBidWeight", "mobileNetworkBidWeight", "useCntsNetworkBidAmt", "systemBiddingType",
  ]);
  assertInvariants("adgroup", account, body);
  return body;
}

export function buildKeyword(account: CapAccount, adgroupId: string, keyword: string, bidAmt: number, declared?: SafetyDeclaration): KeywordCreate {
  const c = caps(account);
  const nccAdgroupId = requireText(adgroupId, "nccAdgroupId");
  const item: KeywordItem = { keyword: requireText(keyword, "keyword"), bidAmt: checkBid(bidAmt, c), useGroupBidAmt: false, userLock: true };
  declare(item, declared, ["useGroupBidAmt", "userLock"]);
  assertInvariants("keyword", account, item);
  return { query: { nccAdgroupId }, body: [item] };
}

// 문구 길이·금칙어는 등록 기준 린터(Task 6) 책임. 여기서는 유형·잠금·필수값·URL 형식만 강제한다.
export function buildTextAd(adgroupId: string, input: TextAdInput, declared?: SafetyDeclaration): TextAdBody {
  const src: Obj = isObj(input) ? input : fail("ad");
  const body: TextAdBody = {
    nccAdgroupId: requireText(adgroupId, "nccAdgroupId"),
    type: "TEXT_45",
    userLock: true,
    ad: {
      headline: requireText(src.headline, "ad.headline"),
      description: requireText(src.description, "ad.description"),
      pc: { final: checkUrl(src.pcUrl, "ad.pc.final") },
      mobile: { final: checkUrl(src.mobileUrl, "ad.mobile.final") },
    },
  };
  declare(body, declared, ["userLock"]);
  assertInvariants("ad", null, body);
  return body;
}

function lockBody(kind: LockKind, naverId: string, userLock: boolean): LockBody {
  if (typeof kind !== "string" || !Object.hasOwn(LOCK_ID_FIELDS, kind)) fail("kind");
  const idField = LOCK_ID_FIELDS[kind];
  return { [idField]: requireText(naverId, idField), userLock };
}

/** 끄기(PUT ?fields=userLock) 최소 본문. 계정 상태와 무관하게 항상 만들 수 있다 — 상한이 깨졌을 때 멈추는 경로이므로. */
export function buildPause(kind: LockKind, naverId: string): LockBody {
  const body = lockBody(kind, naverId, true);
  assertInvariants("pause", null, body);
  return body;
}

/** 켜기(PUT ?fields=userLock) 최소 본문. 사유는 대장 승인 또는 가드 자동 재개뿐. 누가 켤 수 있는지는 Task 11이 강제한다. */
export function buildResume(kind: LockKind, naverId: string, reason: ResumeReason): LockBody {
  if (typeof reason !== "string" || !RESUME_REASONS.includes(reason)) fail("reason");
  const body = lockBody(kind, naverId, false);
  assertInvariants("resume", null, body);
  return body;
}
