// lib/ads/sync-inspect.ts — 심사 추적 크론(설계서 §5.5-8, 30분: vercel.json `*/30 * * * *` UTC).
// - 대상: active 계정(take MAX_ACCOUNTS)의 키워드·소재 미러 중 검수 중인 것(inspectStatus null·PENDING·UNDER_REVIEW, 종류마다 take MAX_ROWS).
// - ids 묶음 조회(GET /ncc/keywords?ids=…, /ncc/ads?ids=…, 묶음당 ID_CHUNK개). 쉼표 형식은 spend.ts idsParam 한 곳(⚠️ Task 13 실측).
// - 쓰는 것은 inspectStatus·lastSyncedAt뿐이다. lockVersion·lockedBy·lockedAt·userLock은 절대 건드리지 않는다(Task 2 m-2 / Task 9 CARRY —
//   동기화 쓰기가 잠금 CAS를 깨지 않게). 행 범위는 (id, adAccountId).
// - 응답은 zod로 parse한다. 형식 오류인 묶음은 기록하고 건너뛴다(값을 지우거나 바꾸지 않는다). 401은 계정을 invalid_key로 바꾼다.
// - DENIED로 새로 바뀐 엔티티마다 ads.inspect_denied 1건(dedupeKey = naverId).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverAdListSchema, naverKeywordListSchema } from "@/schemas/ads";
import { withAccountClient, type AdsDeps } from "./account-core";
import { queueAlert } from "./alerts";
import { ENTITY_PATHS } from "./execution";
import { idsParam } from "./spend";

export const MAX_ACCOUNTS = 50;
export const MAX_ROWS = 1000;
export const ID_CHUNK = 50;
const PENDING = ["PENDING", "UNDER_REVIEW"];

type Kind = "keyword" | "ad";
type Row = { id: string; naverId: string; inspectStatus: string | null };
export type InspectAccountResult = { accountId: string; outcome: "ok" | "error"; reason?: string; updated: number; denied: number; skippedBatches: number };

const pendingWhere = (adAccountId: string) => ({ adAccountId, OR: [{ inspectStatus: null }, { inspectStatus: { in: PENDING } }] });
const SELECT = { id: true, naverId: true, inspectStatus: true } as const;

function pendingRows(kind: Kind, adAccountId: string): Promise<Row[]> {
  const args = { where: pendingWhere(adAccountId), select: SELECT, orderBy: { naverId: "asc" as const }, take: MAX_ROWS };
  return kind === "keyword" ? prisma.adKeyword.findMany(args) : prisma.adCreative.findMany(args);
}

function writeInspect(kind: Kind, id: string, adAccountId: string, inspectStatus: string | null, now: Date) {
  const args = { where: { id, adAccountId }, data: { inspectStatus, lastSyncedAt: now } }; // 이 두 컬럼만
  return kind === "keyword" ? prisma.adKeyword.updateMany(args) : prisma.adCreative.updateMany(args);
}

async function readBatch(client: NaverAdsClient, kind: Kind, ids: string[]): Promise<Map<string, string | null | undefined> | null> {
  const raw = await client.get(ENTITY_PATHS[kind], { ids: idsParam(ids) });
  if (kind === "keyword") {
    const p = naverKeywordListSchema.safeParse(raw);
    return p.success ? new Map(p.data.map((k) => [k.nccKeywordId, k.inspectStatus])) : null;
  }
  const p = naverAdListSchema.safeParse(raw);
  return p.success ? new Map(p.data.map((a) => [a.nccAdId, a.inspectStatus])) : null;
}

async function syncKind(client: NaverAdsClient, account: AdAccount, kind: Kind, now: Date, r: InspectAccountResult, denied: { entity: Kind; naverId: string }[]) {
  const rows = await pendingRows(kind, account.id);
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const chunk = rows.slice(i, i + ID_CHUNK);
    let seen: Map<string, string | null | undefined> | null;
    try {
      seen = await readBatch(client, kind, chunk.map((x) => x.naverId));
    } catch (error) {
      if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") throw error;
      seen = null;
    }
    if (seen === null) {
      console.error("[ads] inspect sync batch skipped", { accountId: account.id, kind });
      r.skippedBatches++;
      continue;
    }
    for (const row of chunk) {
      const status = seen.get(row.naverId);
      if (status === undefined) continue; // 응답에 없거나 값 없음 → 모름, 쓰지 않는다
      await writeInspect(kind, row.id, account.id, status, now);
      r.updated++;
      if (status === "DENIED" && row.inspectStatus !== "DENIED") denied.push({ entity: kind, naverId: row.naverId });
    }
  }
}

async function syncAccount(account: AdAccount, now: Date, deps: AdsDeps): Promise<InspectAccountResult> {
  const r: InspectAccountResult = { accountId: account.id, outcome: "ok", updated: 0, denied: 0, skippedBatches: 0 };
  const denied: { entity: Kind; naverId: string }[] = [];
  await withAccountClient(account, deps, async (client) => {
    for (const kind of ["keyword", "ad"] as const) await syncKind(client, account, kind, now, r, denied);
  });
  r.denied = denied.length;
  for (const d of denied) { // 엔티티마다 1건(dedupeKey = naverId, 판정 Task 11 I-3) — 같은 날 다른 반려도 묻히지 않는다
    try {
      await queueAlert(account.id, "ads.inspect_denied", d, { now: () => now, dedupeKey: d.naverId });
    } catch (error) {
      console.error("[ads] inspect_denied alert queue failed", { type: error instanceof Error ? error.name : "unknown" });
    }
  }
  return r;
}

export async function syncInspect(now: Date = new Date(), deps: AdsDeps = {}): Promise<{ accounts: InspectAccountResult[] }> {
  const accounts = await prisma.adAccount.findMany({ where: { status: "active" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ACCOUNTS });
  const results: InspectAccountResult[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(account, now, deps));
    } catch (error) {
      const reason = error instanceof NaverAdsError ? error.reason : error instanceof Error ? error.name : "unknown";
      console.error("[ads] inspect sync account failed", { accountId: account.id, reason });
      results.push({ accountId: account.id, outcome: "error", reason, updated: 0, denied: 0, skippedBatches: 0 });
    }
  }
  return { accounts: results };
}
