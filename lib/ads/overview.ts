// lib/ads/overview.ts — 광고 계정 개요(Task 12 판정: 화면 /ads가 페이지를 열 때마다 네이버를 부르지 않는다). DB만 읽는다.
// - 소유자 범위: 계정은 (id, ownerId)로만 찾는다 — 남의 id·형식 틀린 id는 404(IDOR). 허용목록은 assertAdsOwner.
// - 계정 DTO는 DTO_SELECT(키 컬럼을 읽지 않음, keyLast4만) + 감시 스냅샷 3개 컬럼. 감시(guard.ts)가 30분마다 남긴 마지막 관찰과 그 나이(분).
// - 미러 4종은 계정 범위 쿼리 1회씩(take 상한, 넘치면 truncated). 성과는 캠페인 미러 naverId `in` 필터로 1회 groupBy(naverId, date)
//   → 캠페인별 7·30일 합계와 날짜별 추이를 메모리에서 만든다. 표마다 쿼리 1회 — 캠페인 수와 무관(N+1 없음).
// - 창: KST 날짜 기준 오늘 포함 7일(D-6..D)·30일(D-29..D). 성과 행 date는 KST 날짜의 00:00Z로 저장된다(sync-stats.ts).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adsAccountIdSchema } from "@/schemas/ads";
import type { AdCampaignPerfDTO, AdDailyPerfDTO, AdGuardSnapshotDTO, AdMirrorBaseDTO, AdOverviewDTO, AdPerfTotals } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { DTO_SELECT, notFound, toAccountDTO } from "./account-core";
import { kstDate } from "./alerts";

export const OVERVIEW_LIMITS = { campaigns: 200, groups: 500, keywords: 1000, ads: 500 } as const;
const DAY_MS = 86_400_000;

const BASE = {
  id: true, naverId: true, parentNaverId: true, name: true, proposalId: true,
  userLock: true, lockedBy: true, lockVersion: true, lockedAt: true, inspectStatus: true,
} as const;
type BaseRow = { id: string; naverId: string; parentNaverId: string | null; name: string; proposalId: string | null;
  userLock: boolean; lockedBy: string | null; lockVersion: number; lockedAt: Date | null; inspectStatus: string | null };

const base = (r: BaseRow): AdMirrorBaseDTO => ({
  id: r.id, naverId: r.naverId, parentNaverId: r.parentNaverId, name: r.name, proposalId: r.proposalId,
  userLock: r.userLock, lockedBy: r.lockedBy, lockVersion: r.lockVersion, lockedAt: r.lockedAt?.toISOString() ?? null, inspectStatus: r.inspectStatus,
});

/** take+1로 읽어 넘침을 안다. */
function capped<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

const zero = (): AdPerfTotals => ({ impCnt: 0, clkCnt: 0, costKrw: 0, ccnt: 0 });
function add(t: AdPerfTotals, r: AdPerfTotals): void {
  t.impCnt += r.impCnt; t.clkCnt += r.clkCnt; t.costKrw += r.costKrw; t.ccnt += r.ccnt;
}

/** KST 날짜 문자열 → 저장 형식(00:00Z) Date. */
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const shiftDay = (day: string, days: number) => new Date(dayDate(day).getTime() - days * DAY_MS).toISOString().slice(0, 10);

function snapshotOf(r: { lastGuardAt: Date | null; lastSpendKrw: number | null; lastBizmoneyKrw: number | null }, now: Date): AdGuardSnapshotDTO {
  if (!r.lastGuardAt) return { at: null, ageMinutes: null, spendKrw: null, bizmoneyKrw: null };
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - r.lastGuardAt.getTime()) / 60_000));
  return { at: r.lastGuardAt.toISOString(), ageMinutes, spendKrw: r.lastSpendKrw, bizmoneyKrw: r.lastBizmoneyKrw };
}

type PerfRow = { naverId: string; date: Date; _sum: { impCnt: number | null; clkCnt: number | null; costKrw: number | null; ccnt: number | null } };

function aggregate(rows: PerfRow[], since7: string): Pick<AdOverviewDTO["performance"], "campaigns" | "daily" | "totals7" | "totals30"> {
  const byCampaign = new Map<string, AdCampaignPerfDTO>();
  const byDay = new Map<string, AdDailyPerfDTO>();
  const totals7 = zero(), totals30 = zero();
  for (const r of rows) {
    const v: AdPerfTotals = { impCnt: r._sum.impCnt ?? 0, clkCnt: r._sum.clkCnt ?? 0, costKrw: r._sum.costKrw ?? 0, ccnt: r._sum.ccnt ?? 0 };
    const day = r.date.toISOString().slice(0, 10);
    const c = byCampaign.get(r.naverId) ?? { naverId: r.naverId, days7: zero(), days30: zero() };
    byCampaign.set(r.naverId, c);
    add(c.days30, v); add(totals30, v);
    if (day >= since7) { add(c.days7, v); add(totals7, v); }
    const d = byDay.get(day) ?? { date: day, ...zero() };
    byDay.set(day, d);
    add(d, v);
  }
  const daily = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const campaigns = [...byCampaign.values()].sort((a, b) => b.days30.costKrw - a.days30.costKrw || (a.naverId < b.naverId ? -1 : 1));
  return { campaigns, daily, totals7, totals30 };
}

export async function getOverview(ownerId: string, accountId: string, now: Date = new Date()): Promise<AdOverviewDTO> {
  assertAdsOwner(ownerId);
  const id = adsAccountIdSchema.safeParse(accountId);
  if (!id.success) throw notFound();
  const row = await prisma.adAccount.findFirst({
    where: { id: id.data, ownerId }, select: { ...DTO_SELECT, lastGuardAt: true, lastSpendKrw: true, lastBizmoneyKrw: true },
  });
  if (!row) throw notFound();
  const scope = { where: { adAccountId: row.id, ownerId } };
  const order = [{ name: "asc" }, { id: "asc" }] satisfies Prisma.AdCampaignOrderByWithRelationInput[];
  const L = OVERVIEW_LIMITS;
  const [campaigns, groups, keywords, ads] = await Promise.all([
    prisma.adCampaign.findMany({ ...scope, select: BASE, orderBy: order, take: L.campaigns + 1 }),
    prisma.adGroup.findMany({ ...scope, select: { ...BASE, bidAmt: true }, orderBy: order, take: L.groups + 1 }),
    prisma.adKeyword.findMany({ ...scope, select: { ...BASE, keyword: true, bidAmt: true }, orderBy: order, take: L.keywords + 1 }),
    prisma.adCreative.findMany({ ...scope, select: { ...BASE, slot: true, headline: true, description: true }, orderBy: order, take: L.ads + 1 }),
  ]);
  const c = capped(campaigns, L.campaigns), g = capped(groups, L.groups), k = capped(keywords, L.keywords), a = capped(ads, L.ads);

  const today = kstDate(now);
  const since7 = shiftDay(today, 6), since30 = shiftDay(today, 29);
  // 캠페인 미러(≤ 200)의 naverId만 · 30일 → 결과 ≤ 200 × 30행(groupBy가 DB에서 합산)
  const perfRows = c.rows.length === 0 ? [] : await prisma.adPerformanceDaily.groupBy({
    by: ["naverId", "date"],
    where: { ownerId, adAccountId: row.id, entityType: "campaign", naverId: { in: c.rows.map((x) => x.naverId) }, date: { gte: dayDate(since30), lte: dayDate(today) } },
    _sum: { impCnt: true, clkCnt: true, costKrw: true, ccnt: true },
  });

  return {
    account: toAccountDTO(row),
    snapshot: snapshotOf(row, now),
    campaigns: c.rows.map(base),
    groups: g.rows.map((r) => ({ ...base(r), bidAmt: r.bidAmt })),
    keywords: k.rows.map((r) => ({ ...base(r), keyword: r.keyword, bidAmt: r.bidAmt })),
    ads: a.rows.map((r) => ({ ...base(r), slot: r.slot, headline: r.headline, description: r.description })),
    truncated: { campaigns: c.truncated, groups: g.truncated, keywords: k.truncated, ads: a.truncated },
    performance: { since7, since30, ...aggregate(perfRows as PerfRow[], since7) },
  };
}
