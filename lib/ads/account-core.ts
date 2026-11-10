// lib/ads/account-core.ts — 광고 계정 공용 내부 함수(연결 accounts.ts·해제 disconnect.ts가 함께 쓴다).
// - DTO는 select로 키 컬럼을 아예 읽지 않는다(keyLast4만). 키 blob이 든 행(loadOwnedAccount)은 서버 내부 전용이다.
// - 저장 계정 호출에서 ads_auth_failed → markInvalidKey(active → invalid_key + 알림 ads.key_invalid).
//   이후 clientForAccount가 status !== 'active'를 네트워크 전에 거부하므로 그 계정의 호출은 0이 된다(크론 포함).
import type { AdAccount, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NaverAdsError, clientForAccount, type NaverAdsBudget, type NaverAdsClient, type NaverAdsClock } from "@/lib/external/naver-searchad";
import { VisibilityError } from "@/lib/visibility/errors";
import { adsAccountIdSchema, naverCampaignListSchema } from "@/schemas/ads";
import type { AdAccountDTO, AdAccountStatus } from "@/types/ads";
import { queueAlert } from "./alerts";
import { AdsHttpError, unexpectedNaverResponse } from "./http";

// now: 시간 판정(해제 재점유) 주입용. naverClock·callBudget: 감시(Task 11)가 모든 네이버 호출에 마감을 거는 선택 인자(naver-searchad ClientOptions).
export type AdsDeps = { transport?: typeof fetch; now?: () => Date; naverClock?: NaverAdsClock; callBudget?: NaverAdsBudget };
export const CAMPAIGN_PAGE = 1000; // 명세 recordSize 상한(1~1000)

/** 멈춘 해제 판정: 'disconnecting'이 updatedAt(해제 점유 시각)에서 이만큼 지나면 죽은 실행(해제 재점유·감시 disconnect_stuck·화면 '다시 시도'). */
export const STALE_CLAIM_MS = 10 * 60_000;

export const DTO_SELECT = {
  id: true, naverCustomerId: true, label: true, keyLast4: true, status: true, dailyCapKrw: true, sharedBudgetKrw: true,
  maxBidKrw: true, sharedBudgetId: true, businessChannelId: true, lastVerifiedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.AdAccountSelect;
type DtoRow = Prisma.AdAccountGetPayload<{ select: typeof DTO_SELECT }>;
const STATUSES: readonly string[] = ["active", "invalid_key", "disconnecting", "disabled"];

export function toAccountDTO(r: DtoRow, now: Date = new Date()): AdAccountDTO {
  const status = (STATUSES.includes(r.status) ? r.status : "disabled") as AdAccountStatus;
  return {
    id: r.id, naverCustomerId: r.naverCustomerId, label: r.label, keyLast4: r.keyLast4, status,
    connected: status !== "disabled" && r.keyLast4 !== null,
    dailyCapKrw: r.dailyCapKrw, sharedBudgetKrw: r.sharedBudgetKrw, maxBidKrw: r.maxBidKrw,
    sharedBudgetId: r.sharedBudgetId, businessChannelId: r.businessChannelId,
    lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    disconnectStuck: status === "disconnecting" && r.updatedAt.getTime() < now.getTime() - STALE_CLAIM_MS,
  };
}

export const notFound = () => new VisibilityError("not_found", "대상을 찾을 수 없습니다.", 404);
export const notConnected = () => new AdsHttpError("ads_not_connected", "연결 해제된 계정입니다. 고객 ID와 키로 다시 연결하세요.", 409);

/** 소유자 범위로 계정 행(키 blob 포함 — 서버 내부 전용)을 읽는다. 형식이 틀린 id도 404. */
export async function loadOwnedAccount(ownerId: string, accountId: unknown): Promise<AdAccount> {
  const id = adsAccountIdSchema.safeParse(accountId);
  if (!id.success) throw notFound();
  const row = await prisma.adAccount.findFirst({ where: { id: id.data, ownerId } });
  if (!row) throw notFound();
  return row;
}

export async function accountDTO(ownerId: string, id: string): Promise<AdAccountDTO> {
  const row = await prisma.adAccount.findFirst({ where: { id, ownerId }, select: DTO_SELECT });
  if (!row) throw notFound();
  return toAccountDTO(row);
}

export async function listAccountDTOs(ownerId: string, take: number): Promise<AdAccountDTO[]> {
  const rows = await prisma.adAccount.findMany({ where: { ownerId }, select: DTO_SELECT, orderBy: { createdAt: "asc" }, take });
  return rows.map((r) => toAccountDTO(r));
}

/** 한 페이지 조회(새 키 검증용). 완전성이 필요한 곳은 listAllCampaigns. */
export async function listCampaigns(client: NaverAdsClient) {
  const parsed = naverCampaignListSchema.safeParse(await client.get("/ncc/campaigns", { recordSize: CAMPAIGN_PAGE }));
  if (!parsed.success) throw unexpectedNaverResponse();
  return parsed.data;
}

export const MAX_CAMPAIGN_PAGES = 50;
export type CampaignRead = { campaigns: { nccCampaignId: string; userLock: boolean; status?: string | null }[]; complete: boolean };

/** 꺼짐 = userLock=true 또는 삭제됨(DELETED는 노출·과금 없음). */
export const isCampaignOff = (c: { userLock: boolean; status?: string | null }) => c.userLock === true || c.status === "DELETED";

/**
 * 모든 캠페인 페이지를 읽는다(명세: recordSize + baseSearchId 커서 + selector=NEXT). 서버가 요청보다 작게 잘라도 놓치지 않게
 * '짧은 페이지'에서 멈추지 않고 빈 페이지가 나올 때까지 다음 커서를 요청한다(1회 추가 GET).
 * complete=false: 커서가 진행하지 않음(새 id 0인 비어있지 않은 페이지 — 커서 미지원) 또는 페이지 상한 도달 → 호출자는 '확인 못 함'으로 본다.
 */
export async function listAllCampaigns(client: Pick<NaverAdsClient, "get">): Promise<CampaignRead> {
  const seen = new Map<string, CampaignRead["campaigns"][number]>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page++) {
    const query = cursor ? { recordSize: CAMPAIGN_PAGE, baseSearchId: cursor, selector: "NEXT" } : { recordSize: CAMPAIGN_PAGE };
    const parsed = naverCampaignListSchema.safeParse(await client.get("/ncc/campaigns", query));
    if (!parsed.success) throw unexpectedNaverResponse();
    if (parsed.data.length === 0) return { campaigns: [...seen.values()], complete: true };
    let added = 0;
    for (const c of parsed.data) if (!seen.has(c.nccCampaignId)) { seen.set(c.nccCampaignId, c); added++; }
    if (added === 0) return { campaigns: [...seen.values()], complete: false };
    cursor = parsed.data[parsed.data.length - 1].nccCampaignId;
  }
  return { campaigns: [...seen.values()], complete: false };
}

/** 키가 무효해졌다: active → invalid_key, 알림 ads.key_invalid(같은 날 1회). 바뀌었으면 true. disabled 행은 건드리지 않는다. */
export async function markInvalidKey(accountId: string, now?: () => Date): Promise<boolean> {
  const { count } = await prisma.adAccount.updateMany({ where: { id: accountId, status: "active" }, data: { status: "invalid_key" } });
  if (count === 0) return false;
  const row = await prisma.adAccount.findUnique({ where: { id: accountId }, select: { naverCustomerId: true } });
  try {
    await queueAlert(accountId, "ads.key_invalid", { naverCustomerId: row?.naverCustomerId ?? "" }, now ? { now } : {}); // 감시는 주입 시각
  } catch (error) {
    // 상태 전환은 이미 저장됐다. 알림 큐 실패가 원래 오류(키 무효)를 가리지 않게 코드만 남긴다.
    console.error("[ads] key_invalid alert queue failed", { type: error instanceof Error ? error.name : "unknown" });
  }
  return true;
}

/** 저장된 계정으로 네이버를 부른다. 키 무효(ads_auth_failed)면 계정을 invalid_key로 바꾸고 다시 던진다. */
export async function withAccountClient<T>(row: AdAccount, deps: AdsDeps, work: (client: NaverAdsClient) => Promise<T>): Promise<T> {
  const client = clientForAccount(row, deps.transport, { clock: deps.naverClock, budget: deps.callBudget });
  try {
    return await work(client);
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") await markInvalidKey(row.id, deps.now);
    throw error;
  }
}
