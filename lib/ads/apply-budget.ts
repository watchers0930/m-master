// lib/ads/apply-budget.ts — 적용(new_campaign)의 공유예산 단계: 캠페인 생성·대조(apply-steps.stepCampaign) 직후에 부른다.
// 핫픽스(2026-11-11 실호출 400/1002, 대장 승인 설계 A — 네이버 쪽 계정 상한 1층 유지):
//   b) 계정에 공유예산이 없으면 POST /ncc/shared-budgets(buildSharedBudget: 이 캠페인 1개를 campaignList로)로 만든다. 만들기 전에
//      이름 mq-cap으로 찾고(다른 적용·이전 실행이 만든 것 재사용), 이 제안의 원장에 보낸 기록(sent·uncertain)이 있으면 재전송 없이 이름 대조만 한다
//      — 없으면 uncertain:shared_budget. 찾은·만든 예산은 재조회 + verifyStored('sharedBudget') 통과 후에만 계정에 '아직 null일 때만' 저장한다.
//      두 적용이 동시에 만들지 않게 점유(apply.ts claim)가 공유예산 없는 계정의 적용을 한 번에 하나로 묶는다.
//   c) 캠페인이 그 예산에 아직 안 붙어 있으면 PUT /ncc/campaigns/{id}?fields=sharedBudget(buildSharedBudgetAttach, 1회). 불확실하면 재조회만
//      — 안 붙었으면 uncertain:shared_budget.attach. 원장에 보낸 기록이 있으면 다시 보내지 않는다.
//   d) 그 뒤 캠페인 재조회(inspect: verifyStored('campaign') — 연결·sharedDailyBudget ≤ 상한) → 공유예산 재조회(verifyStored('sharedBudget')).
//      공유예산이 어긋나면 캠페인을 끄고(pauseAndConfirm) 알림 + drift:sharedBudget.<field>. 끄기 실패면 pause_failed(기존 경로).
//   생성·붙이기는 모두 execution.ts(비상 정지 스위치·계정 active를 보내기 직전 확인) + 원장(oplog)을 거친다.
import { z } from "zod";
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverCampaignSchema, naverSharedBudgetCreatedSchema } from "@/schemas/ads";
import { ApplyFailure } from "./apply-errors";
import { inspect, stopIfUnsafe, uncertainStop } from "./apply-inspect";
import type { ApplyCtx } from "./apply-steps";
import { createEntity, pauseAndConfirm, readEntity, updateEntity } from "./execution";
import { unexpectedNaverResponse } from "./http";
import { buildSharedBudget, buildSharedBudgetAttach } from "./requests";
import { readSharedBudget, sharedBudgetCandidates } from "./shared-budget";

export const BUDGET_STEP = "shared_budget";
export const ATTACH_STEP = "shared_budget.attach";
const acct = (ctx: ApplyCtx) => ({ id: ctx.account.id, ownerId: ctx.account.ownerId });
const linkSchema = z.object({ sharedBudgetId: z.string().nullable().optional() });

async function adoptByName(ctx: ApplyCtx): Promise<string | null> {
  const found = await sharedBudgetCandidates(ctx.client, null);
  if (found.length > 1) throw new ApplyFailure(`ambiguous:${BUDGET_STEP}`);
  return found[0] ?? null;
}

/** b) 계정에 공유예산이 없을 때: 원장 → 이름 재사용 → 생성(1회). 불확실은 재전송 없이 이름 대조, 끝내 없으면 멈춘다. */
async function obtainBudget(ctx: ApplyCtx, campaignId: string, campaignName: string): Promise<string> {
  const prior = ctx.prior.get(BUDGET_STEP);
  if (prior?.status === "ok" && prior.naverId) return prior.naverId;
  if (prior && prior.status !== "failed") return (await adoptByName(ctx)) ?? uncertainStop(ctx, BUDGET_STEP);
  const existing = await adoptByName(ctx);
  if (existing) return existing;
  try {
    const body = buildSharedBudget(ctx.account, { nccCampaignId: campaignId, name: campaignName });
    const made = await createEntity(ctx.client, acct(ctx), { step: BUDGET_STEP, method: "POST", path: "/ncc/shared-budgets", body, proposalId: ctx.proposalId },
      naverSharedBudgetCreatedSchema, (r) => r.sharedBudgetId);
    return made.sharedBudgetId;
  } catch (error) {
    if (!(error instanceof NaverAdsError) || error.reason !== "ads_uncertain") throw error;
    return (await adoptByName(ctx)) ?? uncertainStop(ctx, BUDGET_STEP); // 재전송 금지
  }
}

/** 계정에 '아직 null일 때만' 저장한다. 그 사이 다른 id가 저장됐으면 고르지 않고 멈춘다. */
async function storeBudgetId(ctx: ApplyCtx, id: string): Promise<void> {
  const where = { id: ctx.account.id, ownerId: ctx.account.ownerId };
  const { count } = await prisma.adAccount.updateMany({ where: { ...where, sharedBudgetId: null }, data: { sharedBudgetId: id } });
  if (count !== 1 && (await prisma.adAccount.findFirst({ where, select: { sharedBudgetId: true } }))?.sharedBudgetId !== id)
    throw new ApplyFailure(`ambiguous:${BUDGET_STEP}`);
  ctx.account = { ...ctx.account, sharedBudgetId: id };
}

/** 공유예산이 상한과 다르면: 캠페인을 끄고(이미 꺼져 있어도 다시 확인) 미러에 사실대로 남긴 뒤 drift/pause_failed로 멈춘다. */
async function budgetDrift(ctx: ApplyCtx, campaignId: string, field: string): Promise<never> {
  let confirmed = false;
  try {
    confirmed = (await pauseAndConfirm(ctx.client, ctx.account, "campaign", campaignId, { step: `pause:${ctx.step}`, proposalId: ctx.proposalId })).confirmed;
  } catch (error) {
    if (!(error instanceof NaverAdsError)) throw error;
  }
  await prisma.adCampaign.updateMany({ where: { adAccountId: ctx.account.id, naverId: campaignId }, data: { userLock: confirmed } });
  await stopIfUnsafe(ctx, "campaign", campaignId, { userLock: confirmed, inspectStatus: null, drift: `sharedBudget.${field}`, pauseFailed: !confirmed });
  throw new ApplyFailure(`drift:sharedBudget.${field}`); // stopIfUnsafe가 위에서 이미 던진다(타입용)
}

async function verifiedAmount(ctx: ApplyCtx, campaignId: string, id: string): Promise<number> {
  const read = await readSharedBudget(ctx.client, ctx.account, id);
  return read.ok ? read.dailyBudget : budgetDrift(ctx, campaignId, read.field);
}

async function isLinked(ctx: ApplyCtx, campaignId: string): Promise<boolean> {
  const parsed = linkSchema.safeParse(await readEntity(ctx.client, "campaign", campaignId));
  if (!parsed.success) throw unexpectedNaverResponse();
  return parsed.data.sharedBudgetId === ctx.account.sharedBudgetId;
}

/** c) 아직 안 붙었으면 붙이기 PUT 1회. 원장에 보낸 기록이 있으면 다시 보내지 않는다(ok면 d가 판정, 그 밖은 uncertain). */
async function attachIfNeeded(ctx: ApplyCtx, campaignId: string, amount: number): Promise<void> {
  ctx.step = ATTACH_STEP;
  if (await isLinked(ctx, campaignId)) return;
  const prior = ctx.prior.get(ATTACH_STEP);
  if (prior?.status === "ok") return;
  if (prior && prior.status !== "failed") await uncertainStop(ctx, ATTACH_STEP);
  try {
    await updateEntity(ctx.client, acct(ctx), {
      step: ATTACH_STEP, method: "PUT", path: `/ncc/campaigns/${campaignId}`, query: { fields: "sharedBudget" },
      body: buildSharedBudgetAttach(ctx.account, campaignId, amount), naverId: campaignId, proposalId: ctx.proposalId,
    }, naverCampaignSchema);
  } catch (error) {
    if (!(error instanceof NaverAdsError) || error.reason !== "ads_uncertain") throw error;
    if (!(await isLinked(ctx, campaignId))) await uncertainStop(ctx, ATTACH_STEP); // 재전송 금지: 재조회로만 확인
  }
}

/** 공유예산 단계 전체(b/c → d). 캠페인은 이미 생성·대조·미러 기록된 상태(꺼짐)여야 한다. */
export async function stepSharedBudget(ctx: ApplyCtx, campaignId: string, campaignName: string): Promise<void> {
  ctx.step = BUDGET_STEP;
  await ctx.heartbeat();
  const fresh = await prisma.adAccount.findFirst({ where: { id: ctx.account.id, ownerId: ctx.account.ownerId }, select: { sharedBudgetId: true } });
  ctx.account = { ...ctx.account, sharedBudgetId: fresh?.sharedBudgetId ?? null };
  const known = ctx.account.sharedBudgetId;
  const id = known ?? (await obtainBudget(ctx, campaignId, campaignName));
  const amount = await verifiedAmount(ctx, campaignId, id); // 검증 전에는 계정에 저장하지도, 붙이지도 않는다
  if (!known) await storeBudgetId(ctx, id);
  await attachIfNeeded(ctx, campaignId, amount);
  ctx.step = BUDGET_STEP;
  const o = await inspect(ctx, "campaign", campaignId); // d) 연결·sharedDailyBudget ≤ 상한. 켜져 있으면 inspect가 끈다
  await prisma.adCampaign.updateMany({ where: { adAccountId: ctx.account.id, naverId: campaignId }, data: { userLock: o.userLock } });
  await stopIfUnsafe(ctx, "campaign", campaignId, o);
  await verifiedAmount(ctx, campaignId, id);
}
