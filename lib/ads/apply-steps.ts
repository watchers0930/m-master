// lib/ads/apply-steps.ts — 적용의 단계 하나(엔티티 1개) = 확보(ensureId) → 재조회 대조(inspect) → 미러 기록(pending_launch).
// 확보 순서(재개 안전, Review Focus 2):
//   ① 이 제안의 미러 행이 있으면 그 id ② 원장(oplog)의 이 단계 POST가 ok면 그 naverId(미러 기록 직전에 죽은 경우)
//   ③ 원장에 sent·uncertain이 있으면 결정적 이름으로 목록 대조만 한다 — 1개면 채택, 여럿이면 ambiguous:<step>,
//      0개면 다시 만들지 않는다(재전송 금지, 설계서 §5.3 — 어느 실행에서도, 시간이 지나도). uncertain:<step> + 알림 ads.drift(reason=uncertain).
//   ④ 그 밖(원장 없음 = 보낸 적 없음, failed = 확정 거절)이면 POST 1회. 그 POST가 불확실하면 재전송하지 않고 목록 대조, 없으면 ③과 같이 멈춘다.
// 대조·멈춤 규칙은 apply-inspect.ts(드리프트 → drift:<field>, 끄기 실패 → pause_failed:<step>). 멈추기 전에 미러를 먼저 남긴다.
// 캠페인 단계는 생성·대조 뒤 공유예산 단계(apply-budget.ts: 첫 적용이면 캠페인과 함께 생성, 아니면 붙이기)를 거친다(핫픽스 2026-11-11).
// 미러는 lockedBy='pending_launch', 관찰한 userLock으로 만든다. 이미 있으면 userLock·검수 상태만 갱신(lockedBy·lockVersion 무변경).
// 소재 단계 식별자 = (proposalId, 그룹 인덱스, 소재 인덱스) → step 'ad:g{n}:c{i}', 미러 이름 mq-{id}-g{n}-c{i}(Task 9 판정 I-2).
//   slot은 첫 시도에 정해 원장 step 접미사(#<그룹 id>:a{n})와 미러에 남긴다. 재개는 그 slot을 그대로 쓰고 현재 최대값으로 다시 계산하지 않는다.
import type { AdAccount } from "@prisma/client";
import { z } from "zod";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { NAVER_ID_RE, naverChannelSchema, naverKeywordCreatedSchema } from "@/schemas/ads";
import type { ProposalCreative, ProposalKeyword } from "@/types/ads";
import { ApplyFailure } from "./apply-errors";
import { stepSharedBudget } from "./apply-budget";
import { inspect, stopIfUnsafe, uncertainStop } from "./apply-inspect";
import { createEntity } from "./execution";
import { unexpectedNaverResponse } from "./http";
import { adgroupName, campaignName } from "./names";
import { findAdgroups, findAds, findCampaigns, findKeywords } from "./reconcile";
import { buildAdgroup, buildCampaign, buildKeyword, buildTextAd } from "./requests";

export type PriorOp = { status: string; naverId: string | null; createdAt: Date; slot?: string };
export type ApplyCtx = {
  client: NaverAdsClient; account: AdAccount; proposalId: string; prior: ReadonlyMap<string, PriorOp>;
  now: () => Date; heartbeat: () => Promise<void>; step: string; landingUrl?: string;
};
type Ensure = { step: string; mirror: () => Promise<string | null>; find: () => Promise<string[]>; create: () => Promise<string> };

async function adoptOne(e: Ensure): Promise<string | null> {
  const found = await e.find();
  if (found.length > 1) throw new ApplyFailure(`ambiguous:${e.step}`);
  return found[0] ?? null;
}

async function ensureId(ctx: ApplyCtx, e: Ensure): Promise<string> {
  ctx.step = e.step;
  await ctx.heartbeat();
  const mirrored = await e.mirror();
  if (mirrored) return mirrored;
  const prior = ctx.prior.get(e.step);
  if (prior?.status === "ok" && prior.naverId) return prior.naverId;
  if (prior && prior.status !== "failed") return (await adoptOne(e)) ?? uncertainStop(ctx, e.step); // 대조만, 재전송 없음
  try {
    return await e.create();
  } catch (error) {
    if (!(error instanceof NaverAdsError) || error.reason !== "ads_uncertain") throw error;
    return (await adoptOne(e)) ?? uncertainStop(ctx, e.step); // 재전송 금지: 반영됐는지 목록으로만 확인한다
  }
}

const base = (ctx: ApplyCtx) => ({ ownerId: ctx.account.ownerId, adAccountId: ctx.account.id, proposalId: ctx.proposalId, lockedBy: "pending_launch" });
const key = (ctx: ApplyCtx, naverId: string) => ({ adAccountId_naverId: { adAccountId: ctx.account.id, naverId } });
const idSchema = (field: string) => z.object({ [field]: z.string().regex(NAVER_ID_RE) });
const mirroredIds = async (rows: Promise<{ naverId: string }[]>) => new Set((await rows).map((r) => r.naverId));
const acct = (ctx: ApplyCtx) => ({ id: ctx.account.id, ownerId: ctx.account.ownerId });

export async function stepCampaign(ctx: ApplyCtx): Promise<string> {
  const name = campaignName(ctx.proposalId);
  const id = await ensureId(ctx, {
    step: "campaign",
    mirror: async () => (await prisma.adCampaign.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, name }, select: { naverId: true } }))?.naverId ?? null,
    find: async () => findCampaigns(ctx.client, name, await mirroredIds(prisma.adCampaign.findMany({ where: { adAccountId: ctx.account.id }, select: { naverId: true } })), "campaign"),
    create: async () => (await createEntity(ctx.client, acct(ctx), { step: "campaign", method: "POST", path: "/ncc/campaigns", body: buildCampaign(ctx.account, name), proposalId: ctx.proposalId },
      idSchema("nccCampaignId"), (r) => String(r.nccCampaignId))).nccCampaignId as string,
  });
  const o = await inspect(ctx, "campaign", id, "campaignPreAttach"); // 공유예산에 붙이기 전: 자기 하루 예산이 상한
  await prisma.adCampaign.upsert({ where: key(ctx, id), create: { ...base(ctx), naverId: id, name, userLock: o.userLock }, update: { userLock: o.userLock } });
  await stopIfUnsafe(ctx, "campaign", id, o);
  await stepSharedBudget(ctx, id, name); // 공유예산 생성(첫 캠페인과 함께)·붙이기 → 연결 포함 재대조(apply-budget.ts)
  return id;
}

export async function stepAdgroup(ctx: ApplyCtx, campaignId: string, n: number, bidAmt: number): Promise<string> {
  const name = adgroupName(ctx.proposalId, n), step = `adgroup:g${n}`;
  const id = await ensureId(ctx, {
    step,
    mirror: async () => (await prisma.adGroup.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, name }, select: { naverId: true } }))?.naverId ?? null,
    find: async () => findAdgroups(ctx.client, campaignId, name, await mirroredIds(prisma.adGroup.findMany({ where: { adAccountId: ctx.account.id, parentNaverId: campaignId }, select: { naverId: true } })), step),
    create: async () => (await createEntity(ctx.client, acct(ctx), { step, method: "POST", path: "/ncc/adgroups", body: buildAdgroup(ctx.account, campaignId, name, bidAmt), proposalId: ctx.proposalId },
      idSchema("nccAdgroupId"), (r) => String(r.nccAdgroupId))).nccAdgroupId as string,
  });
  const o = await inspect(ctx, "adgroup", id);
  await prisma.adGroup.upsert({
    where: key(ctx, id), create: { ...base(ctx), naverId: id, parentNaverId: campaignId, name, bidAmt, userLock: o.userLock }, update: { userLock: o.userLock },
  });
  await stopIfUnsafe(ctx, "adgroup", id, o);
  return id;
}

export async function stepKeyword(ctx: ApplyCtx, groupId: string, label: string, i: number, k: ProposalKeyword): Promise<void> {
  const step = `keyword:${label}:k${i}`;
  const id = await ensureId(ctx, {
    step,
    mirror: async () => (await prisma.adKeyword.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, parentNaverId: groupId, keyword: k.keyword }, select: { naverId: true } }))?.naverId ?? null,
    find: async () => findKeywords(ctx.client, groupId, k.keyword, await mirroredIds(prisma.adKeyword.findMany({ where: { adAccountId: ctx.account.id, parentNaverId: groupId }, select: { naverId: true } })), step),
    create: async () => {
      const req = buildKeyword(ctx.account, groupId, k.keyword, k.bidAmt);
      const made = await createEntity(ctx.client, acct(ctx), { step, method: "POST", path: "/ncc/keywords", query: req.query, body: req.body, proposalId: ctx.proposalId },
        naverKeywordCreatedSchema, (r) => r[0].nccKeywordId);
      return made[0].nccKeywordId;
    },
  });
  const o = await inspect(ctx, "keyword", id);
  const seen = { userLock: o.userLock, inspectStatus: o.inspectStatus };
  await prisma.adKeyword.upsert({
    where: key(ctx, id), create: { ...base(ctx), naverId: id, parentNaverId: groupId, name: k.keyword, keyword: k.keyword, bidAmt: k.bidAmt, ...seen }, update: seen,
  });
  await stopIfUnsafe(ctx, "keyword", id, o);
}

/** 소재 최종 URL = 선택한 비즈채널(사이트)의 channelKey. ⚠️ 스킴 없는 값이면 https://를 붙인다(실측 전 가정). 적용 1회에 1번만 읽는다. */
async function landingUrl(ctx: ApplyCtx): Promise<string> {
  if (ctx.landingUrl) return ctx.landingUrl;
  const parsed = naverChannelSchema.safeParse(await ctx.client.get(`/ncc/channels/${ctx.account.businessChannelId}`));
  if (!parsed.success || !parsed.data.channelKey) throw unexpectedNaverResponse();
  const raw = parsed.data.channelKey.trim();
  ctx.landingUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return ctx.landingUrl;
}

/** 소재 1개. slotFor는 첫 시도(미러·원장 모두 없음)에서만 부른다. */
export async function stepAd(ctx: ApplyCtx, groupId: string, label: string, ci: number, c: ProposalCreative, slotFor: () => Promise<string>): Promise<void> {
  const step = `ad:${label}:c${ci}`, name = `mq-${ctx.proposalId}-${label}-c${ci}`;
  ctx.step = step;
  const mirrored = await prisma.adCreative.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, parentNaverId: groupId, name }, select: { naverId: true, slot: true } });
  const slot = mirrored?.slot ?? ctx.prior.get(step)?.slot ?? (await slotFor());
  const id = await ensureId(ctx, {
    step,
    mirror: async () => mirrored?.naverId ?? null,
    find: async () => findAds(ctx.client, groupId, c, await mirroredIds(prisma.adCreative.findMany({ where: { adAccountId: ctx.account.id, parentNaverId: groupId }, select: { naverId: true } }))),
    create: async () => {
      const url = await landingUrl(ctx);
      const body = buildTextAd(groupId, { headline: c.headline, description: c.description, pcUrl: url, mobileUrl: url });
      return (await createEntity(ctx.client, acct(ctx), { step: `${step}#${groupId}:${slot}`, method: "POST", path: "/ncc/ads", body, proposalId: ctx.proposalId },
        idSchema("nccAdId"), (r) => String(r.nccAdId))).nccAdId as string;
    },
  });
  const o = await inspect(ctx, "ad", id); // 네이버가 생성 시 userLock을 무시할 수 있다(명세 #optional-update) → inspect가 끄고 원장에 남긴다
  const seen = { userLock: o.userLock, inspectStatus: o.inspectStatus };
  await prisma.adCreative.upsert({
    where: key(ctx, id),
    create: { ...base(ctx), naverId: id, parentNaverId: groupId, name, slot, headline: c.headline, description: c.description, ...seen },
    update: seen,
  });
  await stopIfUnsafe(ctx, "ad", id, o);
}
