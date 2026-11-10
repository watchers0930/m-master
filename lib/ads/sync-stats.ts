// lib/ads/sync-stats.ts — 성과 수집 크론(설계서 §5.5-9, 매일 KST 06:00 = vercel.json `0 21 * * *` UTC).
// - active 계정(take MAX_ACCOUNTS)의 캠페인·그룹·키워드 미러를 ids 묶음(ID_CHUNK)으로 /stats 조회한다. 최근 days일(기본 7, 어제부터 거꾸로,
//   KST 날짜)을 날짜마다 하루 범위(timeRange since=until)로 다시 읽는다 — 늦게 확정되는 값을 보정. 오늘(KST)은 수집하지 않는다(미확정).
//   ⚠️ 하루씩 부르는 이유: 여러 날 한 번에(timeIncrement 등) 받을 때의 행 형태가 명세로 확인되지 않았다. /stats 형식은 spend.ts statsQuery 한 곳.
// - 저장(최종 판정 A4): 묶음마다 매개변수화한 다중 행 INSERT … ON CONFLICT (ad_account_id, naver_id, date) DO UPDATE 1문
//   ($executeRaw + Prisma.sql — 문자열 보간 없음). (adAccountId, naverId, date) 유니크(Task 2 I-2) → 재수집해도 행이 늘지 않고 값만 갱신(멱등).
//   같은 묶음에 같은 id 행이 여럿이면 합산한다(spend.ts와 같은 규칙, 평균순위는 노출 가중). 한 문이 같은 행을 두 번 건드리지 않게 한다.
//   단위: costKrw = salesAmt(원, VAT 별도 — 네이버 예산 표시 기준과 같다), 정수 원으로 반올림. impCnt·clkCnt·ccnt는 정수, avgRnk는 소수(없으면 null).
//   ownerId·adAccountId는 계정 행에서 온다.
// - 응답은 zod로 parse한다. 형식 오류 묶음은 기록하고 건너뛴다 — 0을 쓰지 않고, 기존 값은 그대로 둔다.
//   유효한 응답에 없는 id는 쓰지 않는다(활동 없음일 가능성 — 0행을 만들지 않는다).
// - 상한: 종류마다 MAX_ENTITIES(2,000)개, 시간 예산 BUDGET_MS(240초). 둘 다 시작 위치를 KST 날짜마다 돌린다(같은 꼬리가 늘 빠지지 않게).
//   잘리면(상한 또는 시간) 개수를 담은 경고 로그 1줄 '[ads] stats sync truncated' { accountId, entityCap, skippedBatches, totalBatches }.
import { randomUUID } from "node:crypto";
import { Prisma, type AdAccount } from "@prisma/client";
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
type Run = { client: NaverAdsClient; account: AdAccount; result: StatsAccountResult };
/** clock·budgetMs: 시간 예산 시계(테스트 주입). */
export type SyncStatsDeps = AdsDeps & { clock?: () => number; budgetMs?: number };
type Metrics = { impCnt: number; clkCnt: number; salesAmt: number; ccnt: number; rnkSum: number; rnkImp: number; rnkLast: number | null };

/** 어제부터 거꾸로 days개의 KST 날짜. */
export function statsDays(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => kstDate(new Date(now.getTime() - (i + 1) * DAY_MS)));
}

/** KST 날짜 번호(날마다 1씩) — 상한·시간 예산 시작 위치를 돌리는 기준. */
export const rotationOf = (now: Date): number => Math.floor(Date.parse(`${kstDate(now)}T00:00:00Z`) / DAY_MS);

const entityModel = (type: EntityType) => (type === "campaign" ? prisma.adCampaign : type === "adgroup" ? prisma.adGroup : prisma.adKeyword) as unknown as {
  count(a: { where: { adAccountId: string } }): Promise<number>;
  findMany(a: { where: { adAccountId: string }; select: { naverId: true }; orderBy: { naverId: "asc" }; skip: number; take: number }): Promise<{ naverId: string }[]>;
};

/** 종류마다 최대 MAX_ENTITIES개. 넘으면 naverId 순 창의 시작을 날마다 돌린다(끝에 닿으면 앞에서 이어 받는다). */
async function naverIds(type: EntityType, adAccountId: string, rotation: number): Promise<{ ids: string[]; total: number }> {
  const model = entityModel(type);
  const where = { adAccountId };
  const total = await model.count({ where });
  const start = total > MAX_ENTITIES ? (rotation * MAX_ENTITIES) % total : 0;
  const page = (skip: number, take: number) => (take > 0 ? model.findMany({ where, select: { naverId: true }, orderBy: { naverId: "asc" }, skip, take }) : Promise.resolve([]));
  const head = await page(start, MAX_ENTITIES);
  const tail = await page(0, Math.min(MAX_ENTITIES, total) - head.length);
  return { ids: [...head, ...tail].map((r) => r.naverId), total };
}

/** 같은 id 행 합산(평균순위는 노출 가중, 노출 0이면 마지막 값). */
function mergeRows(rows: { id: string; impCnt: number; clkCnt: number; salesAmt: number; ccnt: number; avgRnk?: number | null }[], wanted: Set<string>) {
  const out = new Map<string, Metrics>();
  for (const r of rows) {
    if (!wanted.has(r.id)) continue;
    const m = out.get(r.id) ?? { impCnt: 0, clkCnt: 0, salesAmt: 0, ccnt: 0, rnkSum: 0, rnkImp: 0, rnkLast: null };
    Object.assign(m, { impCnt: m.impCnt + r.impCnt, clkCnt: m.clkCnt + r.clkCnt, salesAmt: m.salesAmt + r.salesAmt, ccnt: m.ccnt + r.ccnt });
    if (r.avgRnk !== undefined && r.avgRnk !== null) { m.rnkSum += r.avgRnk * r.impCnt; m.rnkImp += r.impCnt; m.rnkLast = r.avgRnk; }
    out.set(r.id, m);
  }
  return out;
}

/** 묶음 저장: 다중 행 INSERT … ON CONFLICT DO UPDATE 1문(값은 모두 매개변수). */
async function writeBatch(run: Run, type: EntityType, day: string, rows: Map<string, Metrics>): Promise<void> {
  if (rows.size === 0) return;
  const { ownerId, id: adAccountId } = run.account;
  const values = [...rows].map(([naverId, m]) => {
    const avgRnk = m.rnkImp > 0 ? m.rnkSum / m.rnkImp : m.rnkLast;
    return Prisma.sql`(${randomUUID()}, ${ownerId}, ${adAccountId}, ${type}, ${naverId}, ${day}::date, ${m.impCnt}, ${m.clkCnt}, ${Math.round(m.salesAmt)}, ${m.ccnt}, ${avgRnk})`;
  });
  await prisma.$executeRaw`
    INSERT INTO ad_performance_daily (id, owner_id, ad_account_id, entity_type, naver_id, date, imp_cnt, clk_cnt, cost_krw, ccnt, avg_rnk)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (ad_account_id, naver_id, date) DO UPDATE SET
      entity_type = EXCLUDED.entity_type, imp_cnt = EXCLUDED.imp_cnt, clk_cnt = EXCLUDED.clk_cnt,
      cost_krw = EXCLUDED.cost_krw, ccnt = EXCLUDED.ccnt, avg_rnk = EXCLUDED.avg_rnk`;
  run.result.upserted += rows.size;
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
  await writeBatch(run, type, day, mergeRows(parsed.data.data, new Set(chunk)));
}

type Clock = { now: () => number; deadline: number; rotation: number };

async function syncAccount(account: AdAccount, days: string[], clock: Clock, deps: AdsDeps): Promise<StatsAccountResult> {
  const result: StatsAccountResult = { accountId: account.id, outcome: "ok", upserted: 0, skippedBatches: 0 };
  await withAccountClient(account, deps, async (client) => {
    const run: Run = { client, account, result };
    const batches: { type: EntityType; chunk: string[]; day: string }[] = [];
    const entityCap: Record<string, { total: number; kept: number }> = {};
    for (const type of ["campaign", "adgroup", "keyword"] as const) {
      const { ids, total } = await naverIds(type, account.id, clock.rotation);
      if (total > ids.length) entityCap[type] = { total, kept: ids.length };
      for (let i = 0; i < ids.length; i += ID_CHUNK) for (const day of days) batches.push({ type, chunk: ids.slice(i, i + ID_CHUNK), day });
    }
    const start = batches.length ? clock.rotation % batches.length : 0; // 시간 예산에 걸려도 날마다 다른 묶음부터
    for (let k = 0; k < batches.length; k++) {
      const b = batches[(start + k) % batches.length];
      if (clock.now() > clock.deadline) { result.skippedBatches++; continue; }
      await syncBatch(run, b.type, b.chunk, b.day);
    }
    if (Object.keys(entityCap).length || result.skippedBatches)
      console.warn("[ads] stats sync truncated", { accountId: account.id, entityCap, skippedBatches: result.skippedBatches, totalBatches: batches.length });
  });
  return result;
}

export async function syncStats(days = 7, now: Date = new Date(), deps: SyncStatsDeps = {}): Promise<{ accounts: StatsAccountResult[] }> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error("invalid_days");
  const dayList = statsDays(now, days);
  const clockNow = deps.clock ?? Date.now;
  const clock: Clock = { now: clockNow, deadline: clockNow() + (deps.budgetMs ?? BUDGET_MS), rotation: rotationOf(now) };
  const accounts = await prisma.adAccount.findMany({ where: { status: "active" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ACCOUNTS });
  const results: StatsAccountResult[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(account, dayList, clock, deps));
    } catch (error) {
      const reason = error instanceof NaverAdsError ? error.reason : error instanceof Error ? error.name : "unknown";
      console.error("[ads] stats sync account failed", { accountId: account.id, reason });
      results.push({ accountId: account.id, outcome: "error", reason, upserted: 0, skippedBatches: 0 });
    }
  }
  return { accounts: results };
}
