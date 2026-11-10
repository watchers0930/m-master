// lib/ads/apply-steps.ts — 적용의 단계 하나(엔티티 1개) = 확보(ensureId) → 재조회 대조(inspect) → 미러 기록(pending_launch).
// 확보 순서(재개 안전, Review Focus 2):
//   ① 이 제안의 미러 행이 있으면 그 id ② 원장(oplog)의 이 단계 POST가 ok면 그 naverId(미러 기록 직전에 죽은 경우)
//   ③ 원장에 sent·uncertain이 있으면 결정적 이름으로 목록 대조만 한다 — 1개면 채택, 여럿이면 ambiguous:<step>,
//      0개면 다시 만들지 않는다(재전송 금지, 설계서 §5.3 — 어느 실행에서도, 시간이 지나도). uncertain:<step> + 알림 ads.drift(reason=uncertain).
//   ④ 그 밖(원장 없음 = 보낸 적 없음, failed = 확정 거절)이면 POST 1회. 그 POST가 불확실하면 재전송하지 않고 목록 대조, 없으면 ③과 같이 멈춘다.
// 대조(inspect): 단건 GET → 형태 parse → 상한 값 verifyStored(소재는 TEXT_45) → userLock. 네이버가 userLock을 무시해 켜진 채면
//   즉시 끄고(원장 기록) 다시 읽는다. 상한 불일치면 즉시 끄고, 미러를 남기고, 알림 ads.drift 후 drift:<field>로 멈춘다.
// 미러는 lockedBy='pending_launch', 관찰한 userLock으로 만든다. 이미 있으면 userLock·검수 상태만 갱신(lockedBy·lockVersion 무변경).
import type { AdAccount } from "@prisma/client";
import { z } from "zod";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { NAVER_ID_RE, naverChannelSchema, naverKeywordCreatedSchema } from "@/schemas/ads";
import type { ProposalCreative, ProposalKeyword } from "@/types/ads";
import { queueAlert } from "./alerts";
import { ApplyFailure } from "./apply-errors";
import { ENTITY_SCHEMAS, createEntity, putUserLock, readEntity, type EntityOf } from "./execution";
import { unexpectedNaverResponse } from "./http";
import { findAdgroups, findAds, findCampaigns, findKeywords } from "./reconcile";
import { buildAdgroup, buildCampaign, buildKeyword, buildTextAd, verifyStored, type LockKind } from "./requests";

export type PriorOp = { status: string; naverId: string | null; createdAt: Date };
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

/** 반영 여부를 끝내 확인하지 못한 단계: 다시 보내지 않고 멈춘다. 대장이 네이버 화면에서 확인하도록 알린다(같은 날 1회). */
async function uncertainStop(ctx: ApplyCtx, step: string): Promise<never> {
  try {
    await queueAlert(ctx.account.id, "ads.drift", { reason: "uncertain", proposalId: ctx.proposalId, step });
  } catch (error) {
    console.error("[ads] uncertain alert queue failed", { type: error instanceof Error ? error.name : "unknown" });
  }
  throw new ApplyFailure(`uncertain:${step}`);
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

type Observed<K extends LockKind> = { entity: EntityOf<K>; drift: string | null };

async function readParsed<K extends LockKind>(ctx: ApplyCtx, kind: K, naverId: string): Promise<{ raw: unknown; entity: EntityOf<K> | null }> {
  const raw = await readEntity(ctx.client, kind, naverId);
  const parsed = ENTITY_SCHEMAS[kind].safeParse(raw);
  return { raw, entity: parsed.success ? (parsed.data as EntityOf<K>) : null };
}

/** 저장된 값 대조. 불일치·켜짐이면 끈다. drift는 상한 위반 필드(없으면 null). */
async function inspect<K extends LockKind>(ctx: ApplyCtx, kind: K, naverId: string): Promise<Observed<K>> {
  const first = await readParsed(ctx, kind, naverId);
  const raw = first.raw;
  let entity = first.entity;
  const verdict = entity === null ? { ok: false as const, field: "shape" }
    : kind === "ad" ? ((entity as EntityOf<"ad">).type === "TEXT_45" ? { ok: true as const } : { ok: false as const, field: "type" })
      : verifyStored(kind as Exclude<LockKind, "ad">, ctx.account, raw);
  if (!verdict.ok || entity?.userLock !== true) {
    await putUserLock(ctx.client, ctx.account, kind, naverId, true, { step: `pause:${ctx.step}`, proposalId: ctx.proposalId });
    ({ entity } = await readParsed(ctx, kind, naverId));
  }
  if (entity === null) {
    await driftStop(ctx, kind, naverId, "shape"); // 끈 뒤에도 형태를 모르면 미러 없이 멈춘다(재개 시 원장 naverId로 다시 대조)
    throw new ApplyFailure("drift:shape");
  }
  const drift = !verdict.ok ? verdict.field : entity.userLock !== true ? "userLock" : null;
  return { entity, drift };
}

async function driftStop(ctx: ApplyCtx, kind: LockKind, naverId: string, field: string | null): Promise<void> {
  if (field === null) return;
  try {
    await queueAlert(ctx.account.id, "ads.drift", { proposalId: ctx.proposalId, step: ctx.step, entity: kind, naverId, field });
  } catch (error) {
    console.error("[ads] drift alert queue failed", { type: error instanceof Error ? error.name : "unknown" }); // 원래 실패를 가리지 않는다
  }
  throw new ApplyFailure(`drift:${field}`);
}

const base = (ctx: ApplyCtx) => ({ ownerId: ctx.account.ownerId, adAccountId: ctx.account.id, proposalId: ctx.proposalId, lockedBy: "pending_launch" });
const key = (ctx: ApplyCtx, naverId: string) => ({ adAccountId_naverId: { adAccountId: ctx.account.id, naverId } });
const idSchema = (field: string) => z.object({ [field]: z.string().regex(NAVER_ID_RE) });
const mirroredIds = async (rows: Promise<{ naverId: string }[]>) => new Set((await rows).map((r) => r.naverId));
const acct = (ctx: ApplyCtx) => ({ id: ctx.account.id, ownerId: ctx.account.ownerId });

export async function stepCampaign(ctx: ApplyCtx): Promise<string> {
  const name = `mq-${ctx.proposalId}`;
  const id = await ensureId(ctx, {
    step: "campaign",
    mirror: async () => (await prisma.adCampaign.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, name }, select: { naverId: true } }))?.naverId ?? null,
    find: async () => findCampaigns(ctx.client, name, await mirroredIds(prisma.adCampaign.findMany({ where: { adAccountId: ctx.account.id }, select: { naverId: true } })), "campaign"),
    create: async () => (await createEntity(ctx.client, acct(ctx), { step: "campaign", method: "POST", path: "/ncc/campaigns", body: buildCampaign(ctx.account, name), proposalId: ctx.proposalId },
      idSchema("nccCampaignId"), (r) => String(r.nccCampaignId))).nccCampaignId as string,
  });
  const o = await inspect(ctx, "campaign", id);
  await prisma.adCampaign.upsert({ where: key(ctx, id), create: { ...base(ctx), naverId: id, name, userLock: o.entity.userLock }, update: { userLock: o.entity.userLock } });
  await driftStop(ctx, "campaign", id, o.drift);
  return id;
}

export async function stepAdgroup(ctx: ApplyCtx, campaignId: string, n: number, bidAmt: number): Promise<string> {
  const name = `mq-${ctx.proposalId}-g${n}`, step = `adgroup:g${n}`;
  const id = await ensureId(ctx, {
    step,
    mirror: async () => (await prisma.adGroup.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, name }, select: { naverId: true } }))?.naverId ?? null,
    find: async () => findAdgroups(ctx.client, campaignId, name, await mirroredIds(prisma.adGroup.findMany({ where: { adAccountId: ctx.account.id, parentNaverId: campaignId }, select: { naverId: true } })), step),
    create: async () => (await createEntity(ctx.client, acct(ctx), { step, method: "POST", path: "/ncc/adgroups", body: buildAdgroup(ctx.account, campaignId, name, bidAmt), proposalId: ctx.proposalId },
      idSchema("nccAdgroupId"), (r) => String(r.nccAdgroupId))).nccAdgroupId as string,
  });
  const o = await inspect(ctx, "adgroup", id);
  await prisma.adGroup.upsert({
    where: key(ctx, id), create: { ...base(ctx), naverId: id, parentNaverId: campaignId, name, bidAmt, userLock: o.entity.userLock }, update: { userLock: o.entity.userLock },
  });
  await driftStop(ctx, "adgroup", id, o.drift);
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
  const seen = { userLock: o.entity.userLock, inspectStatus: o.entity.inspectStatus ?? null };
  await prisma.adKeyword.upsert({
    where: key(ctx, id), create: { ...base(ctx), naverId: id, parentNaverId: groupId, name: k.keyword, keyword: k.keyword, bidAmt: k.bidAmt, ...seen }, update: seen,
  });
  await driftStop(ctx, "keyword", id, o.drift);
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

export async function stepAd(ctx: ApplyCtx, groupId: string, label: string, slot: string, c: ProposalCreative, mirrorName: string): Promise<void> {
  const step = `ad:${label}:${slot}`;
  const id = await ensureId(ctx, {
    step,
    mirror: async () => (await prisma.adCreative.findFirst({ where: { adAccountId: ctx.account.id, proposalId: ctx.proposalId, parentNaverId: groupId, slot }, select: { naverId: true } }))?.naverId ?? null,
    find: async () => findAds(ctx.client, groupId, c, await mirroredIds(prisma.adCreative.findMany({ where: { adAccountId: ctx.account.id, parentNaverId: groupId }, select: { naverId: true } }))),
    create: async () => {
      const url = await landingUrl(ctx);
      const body = buildTextAd(groupId, { headline: c.headline, description: c.description, pcUrl: url, mobileUrl: url });
      return (await createEntity(ctx.client, acct(ctx), { step, method: "POST", path: "/ncc/ads", body, proposalId: ctx.proposalId },
        idSchema("nccAdId"), (r) => String(r.nccAdId))).nccAdId as string;
    },
  });
  const o = await inspect(ctx, "ad", id); // 네이버가 생성 시 userLock을 무시할 수 있다(명세 #optional-update) → inspect가 끄고 원장에 남긴다
  const seen = { userLock: o.entity.userLock, inspectStatus: o.entity.inspectStatus ?? null };
  await prisma.adCreative.upsert({
    where: key(ctx, id),
    create: { ...base(ctx), naverId: id, parentNaverId: groupId, name: mirrorName, slot, headline: c.headline, description: c.description, ...seen },
    update: seen,
  });
  await driftStop(ctx, "ad", id, o.drift);
}

/** extend_group 대상 그룹: 네이버에서 삭제되지 않았고 상한 값이 지켜지고 있어야 한다. 대상은 이 제안이 만든 것이 아니므로 끄지 않고 알림만. */
export async function checkTarget(ctx: ApplyCtx, groupId: string): Promise<void> {
  ctx.step = "target";
  const { raw, entity } = await readParsed(ctx, "adgroup", groupId);
  if (entity === null) throw unexpectedNaverResponse();
  if (entity.status === "DELETED") throw new ApplyFailure("target_adgroup_deleted");
  const verdict = verifyStored("adgroup", ctx.account, raw);
  if (!verdict.ok) await driftStop(ctx, "adgroup", groupId, verdict.field);
}
