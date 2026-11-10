// lib/ads/guard-cap.ts — 감시 크론의 끄기·상한·비즈머니(guard.ts가 계정마다 부른다).
// - guardPause: 캠페인 하나를 감시가 끈다. ① 미러 의도 기록(CAS (lockedBy, lockVersion), 진 경우 다시 읽어 최대 3회)
//   lockedBy null·guard → 'guard' + lockedAt=now, owner·pending_launch → 그대로 두고 lockVersion만 +1(다음 날 자동 재개 대상이 되지 않게).
//   ② CAS 결과와 무관하게 끄기를 보낸다(끄기가 이긴다) — safetyPause: 끄기 전용 클라이언트(스위치·계정 상태 invalid_key·disconnecting과 무관),
//   재조회 userLock===true일 때만 확인, 결과는 미러에 사실대로, 실패면 ads.pause_failed. 미러가 없는 캠페인(id=null)도 끈다.
// - lockAtCap(≥100%): 네이버에서 지금 읽은 목록 기준으로 켜진 캠페인을 모두 끈다(미러에 없는 것 포함). 목록을 못 읽었거나 불완전하면
//   읽지 못한 미러 캠페인도 끈다(이미 꺼진 것을 다시 끄는 것은 무해). 그다음 ads.cap_100(결과 수 포함).
// - checkBizmoney: GET /billing/bizmoney(zod). 3×dailyCapKrw 미만이면 ads.bizmoney_low. 형식 오류·조회 실패는 기록만(알림·중단 없음).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverBizmoneySchema } from "@/schemas/ads";
import { isCampaignOff, listAllCampaigns, type CampaignRead } from "./account-core";
import { queueAlert, type AdAlertType, type AlertPayload } from "./alerts";
import type { LockDeps } from "./lock-mirror";
import { safetyPause } from "./lock-pause";

export type GuardAccountResult = {
  accountId: string; outcome: "ok" | "skipped" | "error"; reason?: string; todayCostKrw: number | null;
  paused: number; pauseFailed: number; resumed: number; blocked: number; drift: number;
};
export type GuardCtx = { account: AdAccount; client: NaverAdsClient; now: Date; deps: LockDeps; result: GuardAccountResult };

const LOCK_CAS_TRIES = 3;
export const BIZMONEY_DAYS = 3;

export const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");
export const isAuthError = (error: unknown) => error instanceof NaverAdsError && error.reason === "ads_auth_failed";

/** 감시 경로의 안전 끄기 의존성: 알림 KST 날짜도 주입된 now를 쓴다. */
export const guardDeps = (ctx: GuardCtx): LockDeps => ({ ...ctx.deps, now: () => ctx.now });

/** 감시 알림(KST 날짜는 주입된 now 기준). 큐 실패는 감시 흐름을 멈추지 않는다. */
export async function guardAlert(ctx: Pick<GuardCtx, "account" | "now">, type: AdAlertType, payload: AlertPayload): Promise<void> {
  try {
    await queueAlert(ctx.account.id, type, payload, { now: () => ctx.now });
  } catch (error) {
    console.error("[ads] guard alert queue failed", { type, error: errorName(error) });
  }
}

async function recordGuardLock(id: string, now: Date): Promise<void> {
  for (let i = 0; i < LOCK_CAS_TRIES; i++) {
    const cur = await prisma.adCampaign.findUnique({ where: { id }, select: { lockedBy: true, lockVersion: true } });
    if (!cur) return;
    const keep = cur.lockedBy !== null && cur.lockedBy !== "guard";
    const { count } = await prisma.adCampaign.updateMany({
      where: { id, lockedBy: cur.lockedBy, lockVersion: cur.lockVersion },
      data: keep ? { lockVersion: { increment: 1 } } : { lockedBy: "guard", lockedAt: now, lockVersion: { increment: 1 } },
    });
    if (count === 1) return;
  }
  console.error("[ads] guard lock CAS kept losing; pausing anyway", { id });
}

/** 감시 끄기. 끈 것이 확인되면 true. 어떤 실패도 던지지 않는다(safetyPause가 미러 사실 기록 + ads.pause_failed). */
export async function guardPause(ctx: GuardCtx, mirrorId: string | null, naverId: string, reason: string): Promise<boolean> {
  if (mirrorId !== null) {
    try {
      await recordGuardLock(mirrorId, ctx.now);
    } catch (error) {
      console.error("[ads] guard lock intent write failed; pausing anyway", { error: errorName(error) });
    }
  }
  const paused = await safetyPause(ctx.account, "campaign", { id: mirrorId, naverId }, `guard.${reason}`, guardDeps(ctx), { reason, at: "guard" });
  if (paused) ctx.result.paused++;
  else ctx.result.pauseFailed++;
  return paused;
}

/** ≥100%: 켜진 캠페인을 모두 끈다. */
export async function lockAtCap(ctx: GuardCtx, spend: number, cap: number): Promise<void> {
  let read: CampaignRead | null = null;
  try {
    read = await listAllCampaigns(ctx.client);
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error("[ads] guard campaign list failed at cap", { accountId: ctx.account.id, error: errorName(error) });
  }
  const targets = new Map<string, string | null>(); // naverId → 미러 id(null = 미러 없음)
  for (const c of read?.campaigns ?? []) if (!isCampaignOff(c)) targets.set(c.nccCampaignId, null);
  const mirrors = await prisma.adCampaign.findMany({ where: { adAccountId: ctx.account.id }, select: { id: true, naverId: true } });
  const seen = new Set((read?.campaigns ?? []).map((c) => c.nccCampaignId));
  for (const m of mirrors) {
    if (targets.has(m.naverId)) targets.set(m.naverId, m.id);
    else if (!read?.complete && !seen.has(m.naverId)) targets.set(m.naverId, m.id); // 못 읽은 것도 끈다(안전 방향)
  }
  let paused = 0, pauseFailed = 0, unmirrored = 0;
  for (const [naverId, id] of targets) {
    if (id === null) unmirrored++;
    if (await guardPause(ctx, id, naverId, "cap_100")) paused++;
    else pauseFailed++;
  }
  await guardAlert(ctx, "ads.cap_100", { todayCostKrw: spend, dailyCapKrw: cap, paused, pauseFailed, unmirrored, listComplete: read?.complete ?? false });
}

export async function checkBizmoney(ctx: GuardCtx, cap: number): Promise<void> {
  let raw: unknown;
  try {
    raw = await ctx.client.get("/billing/bizmoney");
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error("[ads] bizmoney read failed", { accountId: ctx.account.id, error: errorName(error) });
    return;
  }
  const parsed = naverBizmoneySchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[ads] bizmoney response shape unexpected; no alert", { accountId: ctx.account.id });
    return;
  }
  const thresholdKrw = BIZMONEY_DAYS * cap;
  if (parsed.data.bizmoney < thresholdKrw) await guardAlert(ctx, "ads.bizmoney_low", { bizmoneyKrw: parsed.data.bizmoney, thresholdKrw });
}
