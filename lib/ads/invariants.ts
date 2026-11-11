// lib/ads/invariants.ts — 상한 불변식 공용 검사(설계서 §5.4-2). 빌더(requests.ts)·적용(Task 6)·감시(Task 11)가 보내기 직전 모두 이걸 거친다.
// - 생성 본문(sharedBudget·campaign·adgroup·keyword·ad)은 모든 안전 필드를 강제값과 대조한다. 생성은 항상 userLock=true.
// - 공유예산은 첫 적용 때 캠페인과 함께 만든다(campaignList 1개, 핫픽스 2026-11-11). 그 뒤 캠페인은 sharedBudgetAttach 본문으로 붙인다.
// - 끄기(pause)는 계정 상태와 무관하게 최소 본문 {id, userLock:true}만 본다 — 상한이 깨진 상태에서도 멈출 수 있어야 하므로.
// - 켜기(resume)는 최소 본문 {id, userLock:false}만 통과. 누가 켤 수 있는지는 Task 11이 강제한다.
import type { AdAccount } from "@prisma/client";

export const MIN_BID_KRW = 70;
export const MAX_BID_KRW = 100000; // 네이버 bidAmt 상한(키워드·그룹)
export const DAILY_CAP_CEILING_KRW = 100000; // [대장 결정] 하루 10만 원(VAT 별도). 계정 값이 이보다 커도 거부
export const NEUTRAL_BID_WEIGHT = 100; // 실효 입찰 = bidAmt × weight/100 ≤ maxBid 를 지키는 값

export type CapAccount = Pick<
  AdAccount,
  "naverCustomerId" | "dailyCapKrw" | "sharedBudgetKrw" | "maxBidKrw" | "sharedBudgetId" | "businessChannelId"
>;
export type CreateKind = "sharedBudget" | "campaign" | "adgroup" | "keyword" | "ad";
export type LockKind = "campaign" | "adgroup" | "keyword" | "ad";
// sharedBudgetAttach = 기존 공유예산에 캠페인 붙이기(PUT /ncc/campaigns/{id}?fields=sharedBudget, #962 최소 본문)
export type AdsRequestKind = CreateKind | "sharedBudgetAttach" | "pause" | "resume";

export const LOCK_ID_FIELDS: Readonly<Record<LockKind, string>> = {
  campaign: "nccCampaignId",
  adgroup: "nccAdgroupId",
  keyword: "nccKeywordId",
  ad: "nccAdId",
};
const ID_FIELD_SET = new Set(Object.values(LOCK_ID_FIELDS));
const KINDS: readonly AdsRequestKind[] = ["sharedBudget", "sharedBudgetAttach", "campaign", "adgroup", "keyword", "ad", "pause", "resume"];
export const SHARED_BUDGET_NAME = "mq-cap";
// 공유예산 생성은 같은 유형 캠페인 1개 이상과 함께여야 한다(공식 답변 #834). campaignList 항목 = CampaignRequest의 이 4필드만(#828·#834).
const CAMPAIGN_LIST_KEYS = ["nccCampaignId", "customerId", "name", "campaignTp"] as const;
const ATTACH_KEYS = ["nccCampaignId", "customerId", "sharedBudgetId", "sharedDailyBudget", "sharedBudgetName"] as const;

export class AdsInvariantError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`ads_invariant_${field}`);
    this.name = "AdsInvariantError";
    this.field = field;
  }
}

export function fail(field: string): never {
  throw new AdsInvariantError(field);
}

export type Caps = { dailyCapKrw: number; budget: number; maxBid: number };
export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export function requireText(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(field);
  return v;
}

// 계정 상한값 자체도 검증한다(DB 값이 깨져도 상한이 풀리지 않게). 하루 예산 = min(공유예산 금액, 하루 상한).
export function caps(account: unknown): Caps {
  if (!isObj(account)) fail("account");
  const { dailyCapKrw, sharedBudgetKrw, maxBidKrw } = account;
  if (!isPosInt(dailyCapKrw) || dailyCapKrw > DAILY_CAP_CEILING_KRW) fail("dailyCapKrw");
  if (!isPosInt(sharedBudgetKrw)) fail("sharedBudgetKrw");
  if (!isPosInt(maxBidKrw) || maxBidKrw < MIN_BID_KRW || maxBidKrw > MAX_BID_KRW) fail("maxBidKrw");
  return { dailyCapKrw, budget: Math.min(sharedBudgetKrw, dailyCapKrw), maxBid: maxBidKrw };
}

// 명세: customerId는 int64(#required-create). DB는 문자열이므로 앞자리 0·부호·공백 없는 십진수만 정수로 바꾼다.
export function customerIdOf(account: CapAccount): number {
  const raw = account.naverCustomerId as unknown;
  const n = typeof raw === "string" && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n)) fail("naverCustomerId");
  return n;
}

export function checkBid(v: unknown, c: Caps, field = "bidAmt"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < MIN_BID_KRW || v > Math.min(c.maxBid, MAX_BID_KRW)) fail(field);
  return v;
}

export function checkDailyBudget(v: unknown, c: Caps, field = "dailyBudget"): void {
  if (!isPosInt(v) || v > c.dailyCapKrw) fail(field);
}

export function checkUrl(v: unknown, field: string): string {
  const raw = requireText(v, field);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(field);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail(field);
  return raw;
}

function checkCreateLock(v: unknown): void {
  if (v !== true) fail("userLock"); // 생성 직후는 항상 일시중지. 켜기는 buildResume 경로만.
}

// 끄기·켜기 본문: id 필드 정확히 1개 + userLock. 그 외 키가 있으면 그 키 이름으로 거부.
function assertLockBody(body: Obj, userLock: boolean): void {
  if (body.userLock !== userLock) fail("userLock");
  let ids = 0;
  for (const key of Object.keys(body)) {
    if (key === "userLock") continue;
    if (!ID_FIELD_SET.has(key) || ids > 0) fail(key);
    requireText(body[key], key);
    ids += 1;
  }
  if (ids === 0) fail("id");
}

function onlyKeys(body: Obj, allowed: readonly string[], prefix = ""): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(`${prefix}${key}`);
}

// 생성 본문: ownerType CAMPAIGN · 빠른 소진(ADGROUP이면 이것만 허용, #962) · 우리 캠페인 정확히 1개 · 그룹 목록 금지
function assertSharedBudget(body: Obj, a: CapAccount, c: Caps): void {
  const customerId = customerIdOf(a);
  if (body.customerId !== customerId) fail("customerId");
  if (body.ownerType !== "CAMPAIGN") fail("ownerType");
  if (body.deliveryMethod !== "ACCELERATED") fail("deliveryMethod");
  if ("adgroupList" in body) fail("adgroupList");
  const list = body.campaignList;
  if (!Array.isArray(list) || list.length !== 1 || !isObj(list[0])) fail("campaignList");
  const item = list[0];
  onlyKeys(item, CAMPAIGN_LIST_KEYS, "campaignList.");
  requireText(item.nccCampaignId, "campaignList.nccCampaignId");
  requireText(item.name, "campaignList.name");
  if (item.customerId !== customerId) fail("campaignList.customerId"); // 빠지면 네이버 3507(#834)
  if (item.campaignTp !== "WEB_SITE") fail("campaignList.campaignTp");
  checkDailyBudget(body.dailyBudget, c);
}

// 붙이기 본문: 정확히 5필드, 계정의 공유예산 id·이름, 금액은 상한 이하(호출자가 저장된 금액을 넘긴다)
function assertAttach(body: Obj, a: CapAccount, c: Caps): void {
  onlyKeys(body, ATTACH_KEYS);
  requireText(body.nccCampaignId, "nccCampaignId");
  if (body.customerId !== customerIdOf(a)) fail("customerId");
  if (body.sharedBudgetId !== requireText(a.sharedBudgetId, "sharedBudgetId")) fail("sharedBudgetId");
  if (body.sharedBudgetName !== SHARED_BUDGET_NAME) fail("sharedBudgetName");
  checkDailyBudget(body.sharedDailyBudget, c, "sharedDailyBudget");
}

function assertAd(body: Obj): void {
  if (body.type !== "TEXT_45") fail("type");
  requireText(body.nccAdgroupId, "nccAdgroupId");
  const ad = isObj(body.ad) ? body.ad : fail("ad");
  requireText(ad.headline, "ad.headline");
  requireText(ad.description, "ad.description");
  checkUrl(isObj(ad.pc) ? ad.pc.final : undefined, "ad.pc.final");
  checkUrl(isObj(ad.mobile) ? ad.mobile.final : undefined, "ad.mobile.final");
  checkCreateLock(body.userLock);
}

function assertAdgroup(body: Obj, a: CapAccount, c: Caps): void {
  if (body.adgroupType !== "WEB_SITE") fail("adgroupType");
  const channel = requireText(a.businessChannelId, "businessChannelId");
  if (body.pcChannelId !== channel) fail("pcChannelId");
  if (body.mobileChannelId !== channel) fail("mobileChannelId");
  if (body.aiAdsOptIn !== false) fail("aiAdsOptIn");
  if (body.useExpSearch !== false) fail("useExpSearch");
  if (body.useDailyBudget !== true) fail("useDailyBudget");
  checkDailyBudget(body.dailyBudget, c);
  checkBid(body.bidAmt, c);
  if (body.pcNetworkBidWeight !== NEUTRAL_BID_WEIGHT) fail("pcNetworkBidWeight");
  if (body.mobileNetworkBidWeight !== NEUTRAL_BID_WEIGHT) fail("mobileNetworkBidWeight");
  if (body.useCntsNetworkBidAmt !== false) fail("useCntsNetworkBidAmt");
  if (body.systemBiddingType !== "NONE") fail("systemBiddingType");
  if (body.sharedBudgetId !== undefined && body.sharedBudgetId !== null) fail("sharedBudgetId"); // 그룹 단위 공유예산 금지
  checkCreateLock(body.userLock);
}

/** 보내기 직전 본문 검사. 위반 시 AdsInvariantError(field). pause·resume·ad는 계정 상한과 무관하다(account 무시). */
export function assertInvariants(kind: "ad" | "pause" | "resume", account: CapAccount | null, body: unknown): void;
export function assertInvariants(kind: Exclude<CreateKind, "ad"> | "sharedBudgetAttach", account: CapAccount, body: unknown): void;
export function assertInvariants(kind: AdsRequestKind, account: CapAccount | null, body: unknown): void {
  if (!KINDS.includes(kind)) fail("kind");
  if (kind === "pause" || kind === "resume" || kind === "ad") {
    if (!isObj(body)) fail("body");
    if (kind === "ad") return assertAd(body);
    return assertLockBody(body, kind === "pause");
  }
  const c = caps(account);
  if (!isObj(body)) fail("body");
  const a = account as CapAccount;
  switch (kind) {
    case "sharedBudget":
      return assertSharedBudget(body, a, c);
    case "sharedBudgetAttach":
      return assertAttach(body, a, c);
    case "campaign":
      if (body.customerId !== customerIdOf(a)) fail("customerId");
      if (body.campaignTp !== "WEB_SITE") fail("campaignTp");
      if ("sharedBudgetId" in body) fail("sharedBudgetId"); // 생성은 공유예산 없이. 붙이기는 sharedBudgetAttach 한 경로뿐
      if (body.useDailyBudget !== true) fail("useDailyBudget");
      checkDailyBudget(body.dailyBudget, c);
      return checkCreateLock(body.userLock);
    case "adgroup":
      return assertAdgroup(body, a, c);
    case "keyword":
      if (typeof body.useGroupBidAmt !== "boolean") fail("useGroupBidAmt");
      if (body.useGroupBidAmt === false) checkBid(body.bidAmt, c); // 그룹 입찰이면 그룹 bidAmt가 상한을 지킨다
      return checkCreateLock(body.userLock);
  }
}
