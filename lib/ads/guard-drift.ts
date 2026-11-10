// lib/ads/guard-drift.ts — 감시 크론의 설정 드리프트 검사(Review Focus 1: 누가 네이버 화면에서 공유예산·ADVoost·확장검색 등을 바꿈).
// - 미러(MINTEQ 기록)에 있는 캠페인마다 지금 네이버에서 새로 읽어 Task 4 verifyStored로 대조한다:
//   계정 공유예산(sharedBudget: id·ownerType·dailyBudget ≤ 상한) → 캠페인(sharedBudgetId 연결·하루 예산·공유예산 금액) →
//   그 캠페인의 모든 광고그룹(aiAdsOptIn·useExpSearch·systemBiddingType·입찰배수·하루 예산·bidAmt). DELETED는 건너뛴다.
// - 드리프트 = 상한 보장이 깨짐 → 그 캠페인이 켜져 있으면 guard로 끈다(알림만 하지 않는다). 꺼져 있으면 알림만(재개 차단은 clean 집합으로).
//   공유예산이 어긋나면 모든 캠페인이 드리프트다. 형식 불일치(shape)도 드리프트로 본다(안전 방향).
// - 조회 실패(네트워크·목록 불완전)는 '확인 못 함'이다: 끄지 않고, 알림하지 않고, clean에 넣지 않는다(→ 자동 재개 안 함).
// - 결과 clean = 이번 실행에서 공유예산·캠페인·모든 그룹이 검사를 통과한 캠페인 naverId. 자동 재개(guard-resume)는 여기 있는 것만 켠다.
// - 알림 ads.drift: 엔티티마다 1건(dedupeKey naverId, 실행당 최대 10건): { at:'guard', entity, naverId, campaign, field, paused }.
// - 마감(ctx.deadline)이 지나면 남은 캠페인은 '확인 못 함'(unchecked) — clean에 넣지 않으므로 재개되지 않는다.
// - 대상(최종 판정 A3): 미러 중 네이버 캠페인 목록(listAllCampaigns)에 있고 DELETED가 아닌 것. 삭제됐거나 네이버에 없는 미러
//   (적용 실패 잔재 등)는 빼고 GET도 하지 않는다. 반려 제안의 미러도 뺀다. 목록을 완전히 못 읽으면 모든 미러를 대상으로 한다(안전 방향).
// - 규모: 대상 전체를 SCAN_PAGE(50)개씩 마감 안에서 넘긴다(조용한 상한 없음). 마감으로 다 못 보면 ads.guard_blind(scan_truncated,
//   covered, total) — 못 본 캠페인은 clean이 아니므로 재개되지 않는다. 캠페인당 GET 1 + 그룹 목록(빈 페이지까지).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { naverAdgroupSchema, naverCampaignSchema } from "@/schemas/ads";
import { isCampaignOff, listAllCampaigns } from "./account-core";
import { readEntity } from "./execution";
import { errorName, guardAlert, guardBlind, guardPause, isAuthError, pastDeadline, type GuardCtx } from "./guard-cap";
import { listAll } from "./reconcile";
import { verifyStored } from "./requests";

export const SCAN_PAGE = 50;
const MAX_ALERT_ITEMS = 10;
const UNVERIFIED = Symbol("unverified");
type DriftItem = { entity: string; naverId: string; campaign?: string; field: string; paused?: boolean };
type CampaignCheck = { deleted: boolean; lit: boolean; known: boolean; item: DriftItem | null }; // known = 켜짐·꺼짐을 실제로 읽었다
export type DriftScan = { clean: Set<string>; budgetOk: boolean };

const groupRow = naverAdgroupSchema.passthrough(); // verifyStored가 원본 필드(aiAdsOptIn 등)를 다시 parse한다

async function checkSharedBudget(ctx: GuardCtx): Promise<string | null | typeof UNVERIFIED> {
  const id = ctx.account.sharedBudgetId;
  if (!id) return "sharedBudgetId";
  let raw: unknown;
  try {
    raw = await ctx.client.get(`/ncc/shared-budgets/${id}`);
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error("[ads] guard shared budget read failed", { accountId: ctx.account.id, error: errorName(error) });
    return UNVERIFIED;
  }
  const verdict = verifyStored("sharedBudget", ctx.account, raw);
  return verdict.ok ? null : verdict.field;
}

/** 캠페인 + 모든 그룹을 새로 읽어 대조. 조회 실패는 던진다(호출자가 '확인 못 함'으로 처리). */
async function checkCampaign(ctx: GuardCtx, naverId: string): Promise<CampaignCheck> {
  const raw = await readEntity(ctx.client, "campaign", naverId);
  const parsed = naverCampaignSchema.safeParse(raw);
  if (parsed.success && parsed.data.status === "DELETED") return { deleted: true, lit: false, known: true, item: null };
  const lit = parsed.success ? !isCampaignOff(parsed.data) : true; // 모르면 켜진 쪽으로 끈다(끄기는 무해) — 단 guard 표시는 안 한다(판정 I-1)
  const known = parsed.success;
  const verdict = verifyStored("campaign", ctx.account, raw);
  if (!verdict.ok) return { deleted: false, lit, known, item: { entity: "campaign", naverId, campaign: naverId, field: verdict.field } };
  const groups = await listAll(ctx.client, "/ncc/adgroups", { nccCampaignId: naverId }, groupRow, (g) => g.nccAdgroupId, "guard.drift");
  for (const g of groups) {
    if (g.status === "DELETED") continue;
    const v = verifyStored("adgroup", ctx.account, g);
    if (!v.ok) return { deleted: false, lit, known, item: { entity: "adgroup", naverId: g.nccAdgroupId, campaign: naverId, field: v.field } };
  }
  return { deleted: false, lit, known, item: null };
}

/** 네이버에 살아 있는(DELETED 아닌) 캠페인 id. 목록을 완전히 못 읽으면 null(→ 모든 미러가 대상). */
async function liveCampaignIds(ctx: GuardCtx): Promise<string[] | null> {
  try {
    const read = await listAllCampaigns(ctx.client);
    return read.complete ? read.campaigns.filter((c) => c.status !== "DELETED").map((c) => c.nccCampaignId) : null;
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error("[ads] guard drift campaign list failed; scanning every mirror", { accountId: ctx.account.id, error: errorName(error) });
    return null;
  }
}

/** 대상 미러를 naverId 순 페이지로 넘긴다. 마감이면 멈추고 남은 대상 수를 센다(네이버 호출 없음). */
async function* eligibleRows(ctx: GuardCtx, live: string[] | null, tally: { remaining: number }) {
  const scope: Prisma.AdCampaignWhereInput = {
    adAccountId: ctx.account.id, NOT: { proposal: { is: { status: "rejected" } } }, ...(live ? { naverId: { in: live } } : {}),
  };
  let after: string | null = null;
  for (;;) {
    const where: Prisma.AdCampaignWhereInput = after === null ? scope : { AND: [scope, { naverId: { gt: after } }] };
    if (pastDeadline(ctx)) { tally.remaining = await prisma.adCampaign.count({ where }); return; }
    const page: { id: string; naverId: string }[] = await prisma.adCampaign.findMany({ where, select: { id: true, naverId: true }, orderBy: { naverId: "asc" }, take: SCAN_PAGE });
    for (const row of page) {
      if (pastDeadline(ctx)) { tally.remaining = await prisma.adCampaign.count({ where: { AND: [scope, { naverId: { gte: row.naverId } }] } }); return; }
      after = row.naverId;
      yield row;
    }
    if (page.length < SCAN_PAGE) return;
  }
}

export async function scanDrift(ctx: GuardCtx): Promise<DriftScan> {
  const items: DriftItem[] = [];
  const clean = new Set<string>();
  const budget = await checkSharedBudget(ctx);
  if (typeof budget === "string") items.push({ entity: "sharedBudget", naverId: ctx.account.sharedBudgetId ?? "", field: budget });
  const tally = { remaining: 0 };
  let covered = 0;
  for await (const row of eligibleRows(ctx, await liveCampaignIds(ctx), tally)) {
    covered++;
    let check: CampaignCheck;
    try {
      check = await checkCampaign(ctx, row.naverId);
    } catch (error) {
      if (isAuthError(error)) throw error;
      console.error("[ads] guard drift check unverified", { accountId: ctx.account.id, error: errorName(error) });
      continue; // 확인 못 함: 끄지 않고 clean에도 넣지 않는다
    }
    if (check.deleted) continue;
    const item = check.item ?? (typeof budget === "string" ? { entity: "campaign", naverId: row.naverId, campaign: row.naverId, field: "sharedBudget" } : null);
    if (item === null) {
      if (budget === null) clean.add(row.naverId);
      continue; // 공유예산을 확인 못 했으면 clean 아님(재개 안 함), 끄지도 않음
    }
    if (check.lit) item.paused = await guardPause(ctx, row.id, row.naverId, "drift", check.known);
    if (check.item !== null || check.lit) items.push(item);
  }
  if (tally.remaining > 0) { // 마감: 확인 못 함(clean 아님 → 재개 안 함). 조용히 멈추지 않는다
    ctx.result.unchecked += tally.remaining;
    await guardBlind(ctx, "scan_truncated", { covered, total: covered + tally.remaining });
  }
  ctx.result.drift = items.length;
  // 엔티티마다 1건(dedupeKey = naverId, 판정 I-3). 같은 엔티티의 같은 날 반복은 1회. 한 실행의 알림 행 수는 MAX_ALERT_ITEMS로 제한.
  for (const item of items.slice(0, MAX_ALERT_ITEMS)) await guardAlert(ctx, "ads.drift", { at: "guard", ...item }, item.naverId);
  return { clean, budgetOk: budget === null };
}
