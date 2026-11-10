// lib/ads/sync-stats.ts — 성과 수집 크론(설계서 §5.5-9, 매일 KST 06:00 = vercel.json `0 21 * * *` UTC).
// - active 계정(take MAX_ACCOUNTS)의 캠페인·그룹·키워드 미러를 ids 묶음(ID_CHUNK)으로 /stats 조회한다. 최근 days일(기본 7, 어제부터 거꾸로,
//   KST 날짜)을 날짜마다 하루 범위(timeRange since=until)로 다시 읽는다 — 늦게 확정되는 값을 보정. 오늘(KST)은 수집하지 않는다(미확정).
//   ⚠️ 하루씩 부르는 이유: 여러 날 한 번에(timeIncrement 등) 받을 때의 행 형태가 명세로 확인되지 않았다. /stats 형식은 spend.ts statsQuery 한 곳.
// - 저장: AdPerformanceDaily upsert (adAccountId, naverId, date) 유니크(Task 2 I-2) → 재수집해도 행이 늘지 않고 값만 갱신(멱등).
//   단위: costKrw = salesAmt(원, VAT 별도 — 네이버 예산 표시 기준과 같다), 정수 원으로 반올림. impCnt·clkCnt·ccnt는 정수, avgRnk는 소수(없으면 null).
//   ownerId·adAccountId는 계정 행에서 온다.
// - 응답은 zod로 parse한다. 형식 오류 묶음은 기록하고 건너뛴다 — 0을 쓰지 않고, 기존 값은 그대로 둔다.
//   유효한 응답에 없는 id는 쓰지 않는다(활동 없음일 가능성 — 0행을 만들지 않는다).
// - 시간 예산: BUDGET_MS(240초)가 지나면 남은 묶음을 건너뛴다(다음 날 7일 재수집이 메운다).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverStatsDetailSchema } from "@/schemas/ads";
import { withAccountClient, type AdsDeps } from "./account-core";
import { kstDate } from "./alerts";
import { statsQuery } from "./spend";

export const MAX_ACCOUNTS = 50;
export const MAX_ENTITIES = 2000;
export const ID_CHUNK = 50;
export const MAX_DAYS = 30;
export const BUDGET_MS = 240_000;
export const STATS_FIELDS = ["impCnt", "clkCnt", "salesAmt", "ccnt", "avgRnk"] as const;
const DAY_MS = 86_400_000;

type EntityType = "campaign" | "adgroup" | "keyword";
export type StatsAccountResult = { accountId: string; outcome: "ok" | "error"; reason?: string; upserted: number; skippedBatches: number };
type Run = { client: NaverAdsClient; account: AdAccount; result: StatsAccountResult; deadline: number };

/** 어제부터 거꾸로 days개의 KST 날짜. */
export function statsDays(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => kstDate(new Date(now.getTime() - (i + 1) * DAY_MS)));
}

async function naverIds(type: EntityType, adAccountId: string): Promise<string[]> {
  const args = { where: { adAccountId }, select: { naverId: true }, orderBy: { naverId: "asc" as const }, take: MAX_ENTITIES };
  const rows = type === "campaign" ? await prisma.adCampaign.findMany(args)
    : type === "adgroup" ? await prisma.adGroup.findMany(args) : await prisma.adKeyword.findMany(args);
  return rows.map((r) => r.naverId);
}

async function syncBatch(run: Run, type: EntityType, chunk: string[], day: string): Promise<void> {
  let raw: unknown;
  try {
    raw = await run.client.get("/stats", statsQuery(chunk, day, STATS_FIELDS));
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") throw error;
    raw = undefined;
  }
  const parsed = naverStatsDetailSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[ads] stats batch skipped", { accountId: run.account.id, type, day });
    run.result.skippedBatches++;
    return;
  }
  const wanted = new Set(chunk);
  const date = new Date(`${day}T00:00:00Z`);
  for (const row of parsed.data.data) {
    if (!wanted.has(row.id)) continue;
    const metrics = { impCnt: row.impCnt, clkCnt: row.clkCnt, costKrw: Math.round(row.salesAmt), ccnt: row.ccnt, avgRnk: row.avgRnk ?? null };
    await prisma.adPerformanceDaily.upsert({
      where: { adAccountId_naverId_date: { adAccountId: run.account.id, naverId: row.id, date } },
      create: { ownerId: run.account.ownerId, adAccountId: run.account.id, entityType: type, naverId: row.id, date, ...metrics },
      update: { entityType: type, ...metrics },
    });
    run.result.upserted++;
  }
}

async function syncAccount(account: AdAccount, days: string[], deadline: number, deps: AdsDeps): Promise<StatsAccountResult> {
  const result: StatsAccountResult = { accountId: account.id, outcome: "ok", upserted: 0, skippedBatches: 0 };
  await withAccountClient(account, deps, async (client) => {
    const run: Run = { client, account, result, deadline };
    for (const type of ["campaign", "adgroup", "keyword"] as const) {
      const ids = await naverIds(type, account.id);
      for (let i = 0; i < ids.length; i += ID_CHUNK)
        for (const day of days) {
          if (Date.now() > run.deadline) { result.skippedBatches++; continue; }
          await syncBatch(run, type, ids.slice(i, i + ID_CHUNK), day);
        }
    }
  });
  return result;
}

export async function syncStats(days = 7, now: Date = new Date(), deps: AdsDeps = {}): Promise<{ accounts: StatsAccountResult[] }> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error("invalid_days");
  const dayList = statsDays(now, days);
  const deadline = Date.now() + BUDGET_MS;
  const accounts = await prisma.adAccount.findMany({ where: { status: "active" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ACCOUNTS });
  const results: StatsAccountResult[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(account, dayList, deadline, deps));
    } catch (error) {
      const reason = error instanceof NaverAdsError ? error.reason : error instanceof Error ? error.name : "unknown";
      console.error("[ads] stats sync account failed", { accountId: account.id, reason });
      results.push({ accountId: account.id, outcome: "error", reason, upserted: 0, skippedBatches: 0 });
    }
  }
  return { accounts: results };
}
