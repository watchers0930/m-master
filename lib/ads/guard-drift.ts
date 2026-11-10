// lib/ads/guard-drift.ts — 감시 크론의 설정 드리프트 검사(Review Focus 1: 누가 네이버 화면에서 공유예산·ADVoost·확장검색 등을 바꿈).
// - 미러(MINTEQ 기록)에 있는 캠페인마다 지금 네이버에서 새로 읽어 Task 4 verifyStored로 대조한다:
//   계정 공유예산(sharedBudget: id·ownerType·dailyBudget ≤ 상한) → 캠페인(sharedBudgetId 연결·하루 예산·공유예산 금액) →
//   그 캠페인의 모든 광고그룹(aiAdsOptIn·useExpSearch·systemBiddingType·입찰배수·하루 예산·bidAmt). DELETED는 건너뛴다.
// - 드리프트 = 상한 보장이 깨짐 → 그 캠페인이 켜져 있으면 guard로 끈다(알림만 하지 않는다). 꺼져 있으면 알림만(재개 차단은 clean 집합으로).
//   공유예산이 어긋나면 모든 캠페인이 드리프트다. 형식 불일치(shape)도 드리프트로 본다(안전 방향).
// - 조회 실패(네트워크·목록 불완전)는 '확인 못 함'이다: 끄지 않고, 알림하지 않고, clean에 넣지 않는다(→ 자동 재개 안 함).
// - 결과 clean = 이번 실행에서 공유예산·캠페인·모든 그룹이 검사를 통과한 캠페인 naverId. 자동 재개(guard-resume)는 여기 있는 것만 켠다.
// - 알림 ads.drift 1건/실행(같은 날 중복 제거): { at:'guard', count, items(최대 10) }.
// - 규모: 계정당 미러 캠페인 MAX_SCAN_CAMPAIGNS(50)개, 캠페인당 GET 1 + 그룹 목록(빈 페이지까지).
import { prisma } from "@/lib/prisma";
import { naverAdgroupSchema, naverCampaignSchema } from "@/schemas/ads";
import { isCampaignOff } from "./account-core";
import { readEntity } from "./execution";
import { errorName, guardAlert, guardPause, isAuthError, type GuardCtx } from "./guard-cap";
import { listAll } from "./reconcile";
import { verifyStored } from "./requests";

export const MAX_SCAN_CAMPAIGNS = 50;
const MAX_ALERT_ITEMS = 10;
const UNVERIFIED = Symbol("unverified");
type DriftItem = { entity: string; naverId: string; campaign?: string; field: string; paused?: boolean };
type CampaignCheck = { deleted: boolean; lit: boolean; item: DriftItem | null };
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
  if (parsed.success && parsed.data.status === "DELETED") return { deleted: true, lit: false, item: null };
  const lit = parsed.success ? !isCampaignOff(parsed.data) : true; // 모르면 켜진 쪽으로(끄기는 무해)
  const verdict = verifyStored("campaign", ctx.account, raw);
  if (!verdict.ok) return { deleted: false, lit, item: { entity: "campaign", naverId, campaign: naverId, field: verdict.field } };
  const groups = await listAll(ctx.client, "/ncc/adgroups", { nccCampaignId: naverId }, groupRow, (g) => g.nccAdgroupId, "guard.drift");
  for (const g of groups) {
    if (g.status === "DELETED") continue;
    const v = verifyStored("adgroup", ctx.account, g);
    if (!v.ok) return { deleted: false, lit, item: { entity: "adgroup", naverId: g.nccAdgroupId, campaign: naverId, field: v.field } };
  }
  return { deleted: false, lit, item: null };
}

export async function scanDrift(ctx: GuardCtx): Promise<DriftScan> {
  const items: DriftItem[] = [];
  const clean = new Set<string>();
  const budget = await checkSharedBudget(ctx);
  if (typeof budget === "string") items.push({ entity: "sharedBudget", naverId: ctx.account.sharedBudgetId ?? "", field: budget });
  const rows = await prisma.adCampaign.findMany({
    where: { adAccountId: ctx.account.id }, select: { id: true, naverId: true }, orderBy: { naverId: "asc" }, take: MAX_SCAN_CAMPAIGNS,
  });
  for (const row of rows) {
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
    if (check.lit) item.paused = await guardPause(ctx, row.id, row.naverId, "drift");
    if (check.item !== null || check.lit) items.push(item);
  }
  ctx.result.drift = items.length;
  if (items.length) await guardAlert(ctx, "ads.drift", { at: "guard", count: items.length, items: items.slice(0, MAX_ALERT_ITEMS) });
  return { clean, budgetOk: budget === null };
}
