// lib/ads/apply-inspect.ts — 적용 중 '네이버에 실제로 저장된 상태' 판정과 멈춤 규칙(apply-steps.ts·apply.ts 공용).
// - inspect: 단건 GET → 형태 parse → 상한 값 verifyStored(소재는 TEXT_45) → userLock. 불일치이거나 켜져 있으면 즉시 끄고 다시 읽는다.
//   그 끄기 PUT이 실패하면(Task 9 판정 adv I-2) pauseFailed — 호출자가 관찰값(userLock=false)으로 미러를 남긴 뒤 stopIfUnsafe가
//   알림 ads.drift(reason=pause_failed) + pause_failed:<step>으로 멈춘다(원장 PUT 행이 실패 증거). 다음 적용은 retryPendingPauses가 먼저 끈다.
// - extend_group 대상(checkTarget·targetIsPaused): 삭제되지 않았고, 상한 값이 지켜지고, 그룹과 캠페인이 네이버에서 꺼져 있어야 한다
//   (켜진 그룹에 소재를 붙이면 생성~끄기 사이·끄기 실패 시 과금된다). 켜져 있으면 target_active — 대장이 먼저 끈다(4-1 한계).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { queueAlert, type AlertPayload } from "./alerts";
import { ApplyFailure } from "./apply-errors";
import { ENTITY_SCHEMAS, putUserLock, readEntity, type EntityOf } from "./execution";
import { unexpectedNaverResponse } from "./http";
import { verifyStored, type LockKind } from "./requests";

export type InspectCtx = { client: NaverAdsClient; account: AdAccount; proposalId: string; step: string };
export type Observed = { userLock: boolean; inspectStatus: string | null; drift: string | null; pauseFailed: boolean };

async function alert(ctx: InspectCtx, payload: AlertPayload): Promise<void> {
  try {
    await queueAlert(ctx.account.id, "ads.drift", { proposalId: ctx.proposalId, step: ctx.step, ...payload });
  } catch (error) {
    console.error("[ads] apply alert queue failed", { type: error instanceof Error ? error.name : "unknown" }); // 원래 실패를 가리지 않는다
  }
}

export async function readParsed<K extends LockKind>(client: NaverAdsClient, kind: K, naverId: string) {
  const raw = await readEntity(client, kind, naverId);
  const parsed = ENTITY_SCHEMAS[kind].safeParse(raw);
  return { raw, entity: parsed.success ? (parsed.data as EntityOf<K>) : null };
}

export async function inspect<K extends LockKind>(ctx: InspectCtx, kind: K, naverId: string): Promise<Observed> {
  const first = await readParsed(ctx.client, kind, naverId);
  let entity = first.entity;
  const verdict = entity === null ? { ok: false as const, field: "shape" }
    : kind === "ad" ? ((entity as EntityOf<"ad">).type === "TEXT_45" ? { ok: true as const } : { ok: false as const, field: "type" })
      : verifyStored(kind as Exclude<LockKind, "ad">, ctx.account, first.raw);
  const field = verdict.ok ? null : verdict.field;
  if (field !== null || entity?.userLock !== true) {
    try {
      await putUserLock(ctx.client, ctx.account, kind, naverId, true, { step: `pause:${ctx.step}`, proposalId: ctx.proposalId });
    } catch (error) {
      if (!(error instanceof NaverAdsError)) throw error;
      return { userLock: entity?.userLock === true, inspectStatus: inspectOf(entity), drift: field, pauseFailed: true };
    }
    ({ entity } = await readParsed(ctx.client, kind, naverId));
  }
  if (entity === null) {
    await alert(ctx, { entity: kind, naverId, field: "shape" }); // 끈 뒤에도 형태를 모르면 미러 없이 멈춘다(재개 시 원장 naverId로 다시 대조)
    throw new ApplyFailure("drift:shape");
  }
  return { userLock: entity.userLock, inspectStatus: inspectOf(entity), drift: field ?? (entity.userLock !== true ? "userLock" : null), pauseFailed: false };
}

const inspectOf = (e: unknown) => ((e as { inspectStatus?: string | null } | null)?.inspectStatus ?? null);

/** 미러를 기록한 뒤 부른다. 끄기 실패가 드리프트보다 먼저다(켜진 엔티티가 남아 있다). */
export async function stopIfUnsafe(ctx: InspectCtx, kind: LockKind, naverId: string, o: Observed): Promise<void> {
  if (o.pauseFailed) {
    await alert(ctx, { reason: "pause_failed", entity: kind, naverId, ...(o.drift ? { field: o.drift } : {}) });
    throw new ApplyFailure(`pause_failed:${ctx.step}`);
  }
  if (o.drift !== null) {
    await alert(ctx, { entity: kind, naverId, field: o.drift });
    throw new ApplyFailure(`drift:${o.drift}`);
  }
}

/** 재개 첫 작업: 이 제안 미러 중 켜진 채 남은 것(끄기 실패)을 먼저 끈다. 실패하면 다시 pause_failed로 멈춘다. */
export async function retryPendingPauses(ctx: InspectCtx): Promise<void> {
  const where = { adAccountId: ctx.account.id, proposalId: ctx.proposalId, userLock: false };
  const sel = { select: { id: true, naverId: true } };
  const pending: [LockKind, { id: string; naverId: string }[]][] = [
    ["campaign", await prisma.adCampaign.findMany({ where, ...sel })], ["adgroup", await prisma.adGroup.findMany({ where, ...sel })],
    ["keyword", await prisma.adKeyword.findMany({ where, ...sel })], ["ad", await prisma.adCreative.findMany({ where, ...sel })],
  ];
  for (const [kind, rows] of pending) for (const row of rows) {
    ctx.step = `retry:${kind}:${row.naverId}`;
    let locked = false;
    try {
      locked = (await putUserLock(ctx.client, ctx.account, kind, row.naverId, true, { step: `pause:${ctx.step}`, proposalId: ctx.proposalId })).userLock;
    } catch (error) {
      if (!(error instanceof NaverAdsError)) throw error;
    }
    const model = { campaign: prisma.adCampaign, adgroup: prisma.adGroup, keyword: prisma.adKeyword, ad: prisma.adCreative }[kind] as unknown as {
      updateMany(a: { where: { id: string }; data: { userLock: boolean } }): Promise<unknown>;
    };
    if (locked) await model.updateMany({ where: { id: row.id }, data: { userLock: true } });
    else await stopIfUnsafe(ctx, kind, row.naverId, { userLock: false, inspectStatus: null, drift: null, pauseFailed: true });
  }
}

/** extend_group 대상 그룹과 그 캠페인이 꺼져 있는가(삭제된 그룹은 판정하지 않는다 — checkTarget이 target_adgroup_deleted). */
export async function targetIsPaused(client: NaverAdsClient, groupId: string): Promise<boolean> {
  const group = (await readParsed(client, "adgroup", groupId)).entity;
  if (group === null) throw unexpectedNaverResponse();
  if (group.status === "DELETED") return true;
  if (group.userLock !== true) return false;
  const campaign = (await readParsed(client, "campaign", group.nccCampaignId)).entity;
  if (campaign === null) throw unexpectedNaverResponse();
  return campaign.userLock === true;
}

export async function checkTarget(ctx: InspectCtx, groupId: string): Promise<void> {
  ctx.step = "target";
  const { raw, entity } = await readParsed(ctx.client, "adgroup", groupId);
  if (entity === null) throw unexpectedNaverResponse();
  if (entity.status === "DELETED") throw new ApplyFailure("target_adgroup_deleted");
  const verdict = verifyStored("adgroup", ctx.account, raw);
  if (!verdict.ok) await stopIfUnsafe(ctx, "adgroup", groupId, { userLock: entity.userLock, inspectStatus: null, drift: verdict.field, pauseFailed: false });
  if (!(await targetIsPaused(ctx.client, groupId))) throw new ApplyFailure("target_active");
}
