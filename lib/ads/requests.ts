// lib/ads/requests.ts — 네이버 검색광고 변이 요청 빌더 + 상한 불변식 + 쓰기 후 재조회 검증(설계서 §5.4-2)
// - 모든 공유예산·캠페인·광고그룹·키워드·소재 생성/수정 본문은 이 빌더로 만들고, 보내기 직전 assertInvariants를 다시 통과시킨다.
// - 네이버의 위험한 기본값(§3: useDailyBudget=false, aiAdsOptIn=true, 확장검색 비율 100%)을 끄는 값을 항상 명시한다.
// - 호출자는 안전 필드를 약화할 수 없다: 강제값과 다른 값을 선언하면 AdsInvariantError(field). 일반 passthrough 없음.
// - 캠페인 하루 예산도 공유예산과 별도로 항상 건다. 둘의 동시 적용 여부가 명세에 없어서(⚠️) 어느 쪽에도 의존하지 않기 위함.
import type { AdAccount } from "@prisma/client";
import { z } from "zod";

export const MIN_BID_KRW = 70;
export const MAX_BID_KRW = 100000; // 네이버 bidAmt 상한(키워드·그룹)
export const DAILY_CAP_CEILING_KRW = 100000; // [대장 결정] 하루 10만 원(VAT 별도). 계정 값이 이보다 커도 거부
export const SHARED_BUDGET_NAME = "mq-cap";

export type CapAccount = Pick<AdAccount, "dailyCapKrw" | "sharedBudgetKrw" | "maxBidKrw" | "sharedBudgetId" | "businessChannelId">;
export type AdsRequestKind = "sharedBudget" | "campaign" | "adgroup" | "keyword" | "ad";
export type StoredKind = Exclude<AdsRequestKind, "ad">;
export type VerifyResult = { ok: true } | { ok: false; field: string };
// 안전 필드를 '같은 값으로' 명시만 할 수 있다. 다른 값·알 수 없는 키는 예외.
export type SafetyDeclaration = Readonly<Record<string, unknown>>;
export type InvariantOptions = { allowUnlock?: boolean }; // 켜기(userLock=false) 본문만 true로 호출한다

export type SharedBudgetBody = { name: string; dailyBudget: number };
export type CampaignBody = {
  name: string; campaignTp: "WEB_SITE"; sharedBudgetId: string; useDailyBudget: true; dailyBudget: number; userLock: true;
};
export type AdgroupBody = {
  nccCampaignId: string; name: string; adgroupType: "WEB_SITE"; pcChannelId: string; mobileChannelId: string; bidAmt: number;
  useDailyBudget: true; dailyBudget: number; aiAdsOptIn: false; useExpSearch: false; userLock: true;
};
export type KeywordBody = { nccAdgroupId: string; keyword: string; bidAmt: number; useGroupBidAmt: false; userLock: true };
export type TextAdInput = { headline: string; description: string; pcUrl: string; mobileUrl: string };
export type TextAdBody = {
  nccAdgroupId: string; type: "TEXT_45"; userLock: true;
  ad: { headline: string; description: string; pc: { final: string }; mobile: { final: string } };
};

export class AdsInvariantError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`ads_invariant_${field}`);
    this.name = "AdsInvariantError";
    this.field = field;
  }
}

function fail(field: string): never {
  throw new AdsInvariantError(field);
}

type Caps = { dailyCapKrw: number; budget: number; maxBid: number };
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function requireText(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(field);
  return v;
}

// 계정 상한값 자체도 검증한다(DB 값이 깨져도 상한이 풀리지 않게). 하루 예산 = min(공유예산 금액, 하루 상한).
function caps(account: unknown): Caps {
  if (!isObj(account)) fail("account");
  const { dailyCapKrw, sharedBudgetKrw, maxBidKrw } = account;
  if (!isPosInt(dailyCapKrw) || dailyCapKrw > DAILY_CAP_CEILING_KRW) fail("dailyCapKrw");
  if (!isPosInt(sharedBudgetKrw)) fail("sharedBudgetKrw");
  if (!isPosInt(maxBidKrw) || maxBidKrw < MIN_BID_KRW || maxBidKrw > MAX_BID_KRW) fail("maxBidKrw");
  return { dailyCapKrw, budget: Math.min(sharedBudgetKrw, dailyCapKrw), maxBid: maxBidKrw };
}

function checkBid(v: unknown, c: Caps, field = "bidAmt"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < MIN_BID_KRW || v > Math.min(c.maxBid, MAX_BID_KRW)) fail(field);
  return v;
}

function checkDailyBudget(v: unknown, c: Caps): void {
  if (!isPosInt(v) || v > c.dailyCapKrw) fail("dailyBudget");
}

function checkLock(v: unknown, opts?: InvariantOptions): void {
  if (opts?.allowUnlock === true ? typeof v !== "boolean" : v !== true) fail("userLock");
}

function checkUrl(v: unknown, field: string): string {
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

function declare<T extends Obj>(body: T, declared: SafetyDeclaration | undefined, allowed: readonly string[]): void {
  if (declared === undefined) return;
  if (!isObj(declared)) fail("declared");
  for (const key of Object.keys(declared)) {
    if (!allowed.includes(key) || !Object.is(declared[key], body[key])) fail(key);
  }
}

const KINDS: readonly AdsRequestKind[] = ["sharedBudget", "campaign", "adgroup", "keyword", "ad"];

function assertAd(body: Obj, opts?: InvariantOptions): void {
  if (body.type !== "TEXT_45") fail("type");
  requireText(body.nccAdgroupId, "nccAdgroupId");
  const ad = isObj(body.ad) ? body.ad : fail("ad");
  requireText(ad.headline, "ad.headline");
  requireText(ad.description, "ad.description");
  checkUrl(isObj(ad.pc) ? ad.pc.final : undefined, "ad.pc.final");
  checkUrl(isObj(ad.mobile) ? ad.mobile.final : undefined, "ad.mobile.final");
  checkLock(body.userLock, opts);
}

/** 보내기 직전 본문 검사. 빌더 출력·적용(Task 6)·감시(Task 11)가 모두 이걸 거친다. 위반 시 AdsInvariantError(field). */
export function assertInvariants(kind: "ad", account: CapAccount | null, body: unknown, opts?: InvariantOptions): void;
export function assertInvariants(kind: StoredKind, account: CapAccount, body: unknown, opts?: InvariantOptions): void;
export function assertInvariants(kind: AdsRequestKind, account: CapAccount | null, body: unknown, opts?: InvariantOptions): void {
  if (!KINDS.includes(kind)) fail("kind");
  if (kind === "ad") {
    if (!isObj(body)) fail("body");
    return assertAd(body, opts); // 소재에는 계정 상한에 걸린 값이 없다
  }
  const c = caps(account);
  if (!isObj(body)) fail("body");
  const a = account as CapAccount;
  switch (kind) {
    case "sharedBudget":
      checkDailyBudget(body.dailyBudget, c);
      return;
    case "campaign":
      if (body.campaignTp !== "WEB_SITE") fail("campaignTp");
      if (body.sharedBudgetId !== requireText(a.sharedBudgetId, "sharedBudgetId")) fail("sharedBudgetId");
      if (body.useDailyBudget !== true) fail("useDailyBudget");
      checkDailyBudget(body.dailyBudget, c);
      return checkLock(body.userLock, opts);
    case "adgroup": {
      if (body.adgroupType !== "WEB_SITE") fail("adgroupType");
      const channel = requireText(a.businessChannelId, "businessChannelId");
      if (body.pcChannelId !== channel) fail("pcChannelId");
      if (body.mobileChannelId !== channel) fail("mobileChannelId");
      if (body.aiAdsOptIn !== false) fail("aiAdsOptIn");
      if (body.useExpSearch !== false) fail("useExpSearch");
      if (body.useDailyBudget !== true) fail("useDailyBudget");
      checkDailyBudget(body.dailyBudget, c);
      checkBid(body.bidAmt, c);
      return checkLock(body.userLock, opts);
    }
    case "keyword":
      if (typeof body.useGroupBidAmt !== "boolean") fail("useGroupBidAmt");
      if (body.useGroupBidAmt === false) checkBid(body.bidAmt, c); // 그룹 입찰이면 그룹 bidAmt가 상한을 지킨다
      return checkLock(body.userLock, opts);
  }
}

export function buildSharedBudget(account: CapAccount): SharedBudgetBody {
  const body: SharedBudgetBody = { name: SHARED_BUDGET_NAME, dailyBudget: caps(account).budget };
  assertInvariants("sharedBudget", account, body);
  return body;
}

export function buildCampaign(account: CapAccount, name: string, declared?: SafetyDeclaration): CampaignBody {
  const c = caps(account);
  const body: CampaignBody = {
    name: requireText(name, "name"),
    campaignTp: "WEB_SITE",
    sharedBudgetId: requireText(account.sharedBudgetId, "sharedBudgetId"),
    useDailyBudget: true,
    dailyBudget: c.budget,
    userLock: true,
  };
  declare(body, declared, ["sharedBudgetId", "useDailyBudget", "dailyBudget", "userLock"]);
  assertInvariants("campaign", account, body);
  return body;
}

export function buildAdgroup(account: CapAccount, campaignId: string, name: string, bidAmt: number, declared?: SafetyDeclaration): AdgroupBody {
  const c = caps(account);
  const channel = requireText(account.businessChannelId, "businessChannelId");
  const body: AdgroupBody = {
    nccCampaignId: requireText(campaignId, "nccCampaignId"),
    name: requireText(name, "name"),
    adgroupType: "WEB_SITE",
    pcChannelId: channel,
    mobileChannelId: channel,
    bidAmt: checkBid(bidAmt, c),
    useDailyBudget: true,
    dailyBudget: c.budget,
    aiAdsOptIn: false,
    useExpSearch: false,
    userLock: true,
  };
  declare(body, declared, ["aiAdsOptIn", "useExpSearch", "useDailyBudget", "dailyBudget", "userLock"]);
  assertInvariants("adgroup", account, body);
  return body;
}

export function buildKeyword(account: CapAccount, adgroupId: string, keyword: string, bidAmt: number, declared?: SafetyDeclaration): KeywordBody {
  const c = caps(account);
  const body: KeywordBody = {
    nccAdgroupId: requireText(adgroupId, "nccAdgroupId"),
    keyword: requireText(keyword, "keyword"),
    bidAmt: checkBid(bidAmt, c),
    useGroupBidAmt: false,
    userLock: true,
  };
  declare(body, declared, ["useGroupBidAmt", "userLock"]);
  assertInvariants("keyword", account, body);
  return body;
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

// 재조회(GET) 응답 형태. 추가 필드는 버린다(strip). 필수 필드 누락·타입 불일치는 shape 실패.
const int = z.number().int();
const STORED_SCHEMAS = {
  sharedBudget: z.object({ dailyBudget: int }),
  campaign: z.object({ sharedBudgetId: z.string(), useDailyBudget: z.boolean(), dailyBudget: int }),
  adgroup: z.object({ aiAdsOptIn: z.boolean(), useExpSearch: z.boolean(), useDailyBudget: z.boolean(), dailyBudget: int, bidAmt: int }),
  keyword: z.object({ useGroupBidAmt: z.boolean(), bidAmt: int }),
} as const;

function checkStored(kind: StoredKind, a: CapAccount, c: Caps, stored: unknown): VerifyResult {
  const parsed = STORED_SCHEMAS[kind].safeParse(stored);
  if (!parsed.success) return { ok: false, field: "shape" };
  const s: Obj = parsed.data;
  if (kind === "campaign") {
    if (s.sharedBudgetId !== requireText(a.sharedBudgetId, "sharedBudgetId")) fail("sharedBudgetId");
    if (s.useDailyBudget !== true) fail("useDailyBudget");
  }
  if (kind === "adgroup") {
    if (s.aiAdsOptIn !== false) fail("aiAdsOptIn");
    if (s.useExpSearch !== false) fail("useExpSearch");
    if (s.useDailyBudget !== true) fail("useDailyBudget");
  }
  if (kind !== "keyword") checkDailyBudget(s.dailyBudget, c);
  if (kind === "adgroup" || (kind === "keyword" && s.useGroupBidAmt === false)) checkBid(s.bidAmt, c);
  return { ok: true };
}

/** 쓰기 직후 네이버에 '실제로 저장된 값'을 대조한다. 어떤 실패(형태·계정 값 포함)도 ok:true가 될 수 없다. */
export function verifyStored(kind: StoredKind, account: CapAccount, stored: unknown): VerifyResult {
  if (typeof kind !== "string" || !Object.hasOwn(STORED_SCHEMAS, kind)) return { ok: false, field: "kind" };
  try {
    const c = caps(account);
    return checkStored(kind, account, c, stored);
  } catch (e) {
    if (e instanceof AdsInvariantError) return { ok: false, field: e.field };
    throw e;
  }
}
