// lib/ads/overview.ts — 광고 계정 개요(Task 12 판정: 화면 /ads가 페이지를 열 때마다 네이버를 부르지 않는다). DB만 읽는다.
// - 소유자 범위: 계정은 (id, ownerId)로만 찾는다 — 남의 id·형식 틀린 id는 404(IDOR). 허용목록은 assertAdsOwner.
// - 계정 DTO는 DTO_SELECT(키 컬럼을 읽지 않음, keyLast4만) + 감시 스냅샷 3개 컬럼. 감시(guard.ts)가 30분마다 남긴 마지막 관찰과 그 나이(분).
// - 미러 4종은 계정 범위 쿼리 1회씩(take 상한, 넘치면 truncated). 성과는 캠페인 미러 naverId `in` 필터로 1회 groupBy(naverId, date)
//   → 캠페인별 7·30일 합계와 날짜별 추이를 메모리에서 만든다. 표마다 쿼리 1회 — 캠페인 수와 무관(N+1 없음).
// - 창: KST 날짜 기준 오늘 포함 7일(D-6..D)·30일(D-29..D). 성과 행 date는 KST 날짜의 00:00Z로 저장된다(sync-stats.ts).
// - 안전 경보(최종 판정 B1): 최근 48시간의 SAFETY_ALERT_TYPES를 DB에서 그대로(미발송 포함 — 메일이 실패해도 화면에 보인다), 쿼리 1회·take 상한.
//   payload는 알려진 필드만 싣는다. 미러 pauseUnconfirmed = 켜짐 기록인데 잠금 의도(lockedBy)가 남아 있거나, 마지막 잠금 변경(lockedAt) 뒤에
//   그 naverId의 ads.pause_failed(paused:false)가 있음 → 화면은 '켜짐'(녹색) 대신 '꺼지지 않았을 수 있음'(붉게). 대장 켜기는 lockedBy를 비운다.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adsAccountIdSchema } from "@/schemas/ads";
import type {
  AdCampaignPerfDTO, AdDailyPerfDTO, AdGuardSnapshotDTO, AdMirrorBaseDTO, AdOverviewDTO, AdPerfTotals, AdSafetyAlertDTO, AdSafetyAlertType,
} from "@/types/ads";
import { assertAdsOwner } from "./access";
import { DTO_SELECT, notFound, toAccountDTO } from "./account-core";
import { kstDate } from "./alerts";

export const OVERVIEW_LIMITS = { campaigns: 200, groups: 500, keywords: 1000, ads: 500 } as const;
export const SAFETY_ALERT_TYPES: readonly AdSafetyAlertType[] = ["ads.pause_failed", "ads.guard_blind", "ads.cap_100", "ads.drift", "ads.inspect_denied"];
export const OVERVIEW_ALERT_LIMIT = 100;
export const ALERT_WINDOW_MS = 48 * 3_600_000;
const DAY_MS = 86_400_000;

const BASE = {
  id: true, naverId: true, parentNaverId: true, name: true, proposalId: true,
  userLock: true, lockedBy: true, lockVersion: true, lockedAt: true, inspectStatus: true,
} as const;
type BaseRow = { id: string; naverId: string; parentNaverId: string | null; name: string; proposalId: string | null;
  userLock: boolean; lockedBy: string | null; lockVersion: number; lockedAt: Date | null; inspectStatus: string | null };

/** naverId → 마지막 '끄기 확인 못 함'(pause_failed paused:false) 시각(ms). */
type Unconfirmed = Map<string, number>;

const base = (unconfirmed: Unconfirmed) => (r: BaseRow): AdMirrorBaseDTO => {
  const failedAt = unconfirmed.get(r.naverId);
  return {
    id: r.id, naverId: r.naverId, parentNaverId: r.parentNaverId, name: r.name, proposalId: r.proposalId,
    userLock: r.userLock, lockedBy: r.lockedBy, lockVersion: r.lockVersion, lockedAt: r.lockedAt?.toISOString() ?? null, inspectStatus: r.inspectStatus,
    // 잠금 의도(lockedBy)가 남았는데 켜짐 = 끄기 확인 없음. 같은 날 재시도 실패는 경보가 첫 행으로 합쳐져 시각 비교만으론 놓친다(재검토 N1)
    pauseUnconfirmed: !r.userLock && (r.lockedBy !== null || (failedAt !== undefined && failedAt >= (r.lockedAt?.getTime() ?? 0))),
  };
};

type AlertRow = { type: string; createdAt: Date; sentAt: Date | null; payload: Prisma.JsonValue };
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : null);

function toAlertDTO(r: AlertRow): AdSafetyAlertDTO {
  const p = (r.payload && typeof r.payload === "object" && !Array.isArray(r.payload) ? r.payload : {}) as Record<string, unknown>;
  return {
    type: r.type as AdSafetyAlertType, at: r.createdAt.toISOString(), sent: r.sentAt !== null,
    reason: str(p.reason), entity: str(p.entity), naverId: str(p.naverId), field: str(p.field),
    paused: typeof p.paused === "boolean" ? p.paused : null, pauseFailed: typeof p.pauseFailed === "number" ? p.pauseFailed : null,
  };
}

function unconfirmedOf(alerts: AdSafetyAlertDTO[]): Unconfirmed {
  const out: Unconfirmed = new Map();
  for (const a of alerts) {
    if (a.type !== "ads.pause_failed" || a.paused !== false || !a.naverId) continue;
    out.set(a.naverId, Math.max(out.get(a.naverId) ?? 0, Date.parse(a.at)));
  }
  return out;
}

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
  const [alertRows, campaigns, groups, keywords, ads] = await Promise.all([
    prisma.adAlert.findMany({
      where: { adAccountId: row.id, ownerId, type: { in: [...SAFETY_ALERT_TYPES] }, createdAt: { gte: new Date(now.getTime() - ALERT_WINDOW_MS) } },
      select: { type: true, createdAt: true, sentAt: true, payload: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: OVERVIEW_ALERT_LIMIT,
    }),
    prisma.adCampaign.findMany({ ...scope, select: BASE, orderBy: order, take: L.campaigns + 1 }),
    prisma.adGroup.findMany({ ...scope, select: { ...BASE, bidAmt: true }, orderBy: order, take: L.groups + 1 }),
    prisma.adKeyword.findMany({ ...scope, select: { ...BASE, keyword: true, bidAmt: true }, orderBy: order, take: L.keywords + 1 }),
    prisma.adCreative.findMany({ ...scope, select: { ...BASE, slot: true, headline: true, description: true }, orderBy: order, take: L.ads + 1 }),
  ]);
  const c = capped(campaigns, L.campaigns), g = capped(groups, L.groups), k = capped(keywords, L.keywords), a = capped(ads, L.ads);
  const alerts = alertRows.map(toAlertDTO);
  const mirror = base(unconfirmedOf(alerts));

  const today = kstDate(now);
  const since7 = shiftDay(today, 6), since30 = shiftDay(today, 29);
  // 캠페인 미러(≤ 200)의 naverId만 · 30일 → 결과 ≤ 200 × 30행(groupBy가 DB에서 합산)
  const perfRows = c.rows.length === 0 ? [] : await prisma.adPerformanceDaily.groupBy({
    by: ["naverId", "date"],
    where: { ownerId, adAccountId: row.id, entityType: "campaign", naverId: { in: c.rows.map((x) => x.naverId) }, date: { gte: dayDate(since30), lte: dayDate(today) } },
    _sum: { impCnt: true, clkCnt: true, costKrw: true, ccnt: true },
  });

  return {
    account: toAccountDTO(row, now),
    snapshot: snapshotOf(row, now),
    alerts,
    campaigns: c.rows.map(mirror),
    groups: g.rows.map((r) => ({ ...mirror(r), bidAmt: r.bidAmt })),
    keywords: k.rows.map((r) => ({ ...mirror(r), keyword: r.keyword, bidAmt: r.bidAmt })),
    ads: a.rows.map((r) => ({ ...mirror(r), slot: r.slot, headline: r.headline, description: r.description })),
    truncated: { campaigns: c.truncated, groups: g.truncated, keywords: k.truncated, ads: a.truncated },
    performance: { since7, since30, ...aggregate(perfRows as PerfRow[], since7) },
  };
}
