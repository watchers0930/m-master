// lib/ads/guard-cap.ts — 감시 크론 공용 문맥·알림 + 끄기·상한·비즈머니(guard.ts가 계정마다 부른다).
// - guardPause(판정 Task 11 I-1): 캠페인 하나를 감시가 끈다.
//   ① 미러가 있으면 lockVersion만 +1(의도 — 같은 순간 대장 켜기의 결과 기록 CAS를 깨서 lock_race 재끄기로 보낸다). lockedBy는 아직 그대로.
//   ② 끄기를 보낸다(늘 보낸다 — 끄기가 이긴다): safetyPause = 끄기 전용 클라이언트(스위치·invalid_key·disconnecting과 무관),
//      재조회 userLock===true일 때만 확인, 결과는 미러에 사실대로, 실패면 ads.pause_failed. 원장 step에 끄기 전 상태(pre_on|pre_unknown).
//   ③ lockedBy='guard'(+ lockedAt=now)는 감시가 새로 읽어 '켜짐'을 본 것을 스스로 끄고 확인했을 때만, 그리고 이전 lockedBy가 null·guard일 때만
//      붙인다(①의 버전 CAS). 상태를 모르는 것·못 본 것·owner·pending_launch는 절대 guard로 표시하지 않는다 → 다음 날 자동 재개 대상이 아니다.
// - lockAtCap(≥100%): 네이버에서 새로 읽은 목록 기준 켜진 캠페인을 모두 끈다(미러 없는 것 포함). 목록 조회 실패·불완전 → ads.guard_blind
//   (campaign_list_incomplete) + 목록에서 못 본 미러는 단건 재조회: 켜짐 → 끄기(guard), 꺼짐 → 그대로, 못 읽음 → 끄기만(표시 없음).
//   마감(ctx.deadline)이 지나면 남은 대상은 '확인 못 함'(unchecked) — 판정 I-4: 발송 몫을 남긴다. 그다음 ads.cap_100(결과 수 포함).
// - checkBizmoney: GET /billing/bizmoney(zod). 3×dailyCapKrw 미만이면 ads.bizmoney_low. 형식 오류·조회 실패는 기록만(알림·중단 없음).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverBizmoneySchema, naverCampaignSchema } from "@/schemas/ads";
import { isCampaignOff, listAllCampaigns, type CampaignRead } from "./account-core";
import { queueAlert, type AdAlertType, type AlertPayload } from "./alerts";
import { readEntity } from "./execution";
import type { LockDeps } from "./lock-mirror";
import { safetyPause } from "./lock-pause";

export type GuardAccountResult = {
  accountId: string; outcome: "ok" | "skipped" | "error"; reason?: string; todayCostKrw: number | null;
  paused: number; pauseFailed: number; resumed: number; blocked: number; drift: number; unchecked: number;
};
export type GuardCtx = {
  account: AdAccount; client: NaverAdsClient; now: Date; deps: LockDeps; result: GuardAccountResult;
  clock: () => number; deadline: number; // 마감(ms, clock 기준). 지나면 루프를 멈추고 남은 것은 '확인 못 함'
};

const LOCK_CAS_TRIES = 3;
export const BIZMONEY_DAYS = 3;

export const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");
export const isAuthError = (error: unknown) => error instanceof NaverAdsError && error.reason === "ads_auth_failed";
export const pastDeadline = (ctx: Pick<GuardCtx, "clock" | "deadline">) => ctx.clock() >= ctx.deadline;

/** 감시 알림(KST 날짜는 주입된 now 기준, dedupeKey는 판정 I-3). 큐 실패는 감시 흐름을 멈추지 않는다. */
export async function guardAlert(ctx: Pick<GuardCtx, "account" | "now">, type: AdAlertType, payload: AlertPayload, dedupeKey = ""): Promise<void> {
  try {
    await queueAlert(ctx.account.id, type, payload, { now: () => ctx.now, dedupeKey });
  } catch (error) {
    console.error("[ads] guard alert queue failed", { type, error: errorName(error) });
  }
}

/** 감시 불가(계정·KST 날짜·사유당 1회). 자동 끄기는 하지 않는다 — 네이버 공유예산(1층)이 여전히 상한이다. 비밀값 없음. */
export async function guardBlind(ctx: Pick<GuardCtx, "account" | "now">, reason: string, extra: AlertPayload = {}): Promise<void> {
  const { dailyCapKrw, sharedBudgetKrw } = ctx.account;
  await guardAlert(ctx, "ads.guard_blind", { reason, ...extra, dailyCapKrw, sharedBudgetKrw }, reason);
}

/** 감시 경로의 안전 끄기 의존성: 알림 KST 날짜도 주입된 now를 쓴다. */
export const guardDeps = (ctx: GuardCtx): LockDeps => ({ ...ctx.deps, now: () => ctx.now });

/** ① 의도: lockVersion만 +1(CAS, 진 경우 다시 읽어 최대 3회). 성공하면 올린 뒤의 (lockedBy, lockVersion). */
async function bumpIntent(id: string): Promise<{ lockedBy: string | null; lockVersion: number } | null> {
  for (let i = 0; i < LOCK_CAS_TRIES; i++) {
    const cur = await prisma.adCampaign.findUnique({ where: { id }, select: { lockedBy: true, lockVersion: true } });
    if (!cur) return null;
    const { count } = await prisma.adCampaign.updateMany({ where: { id, lockedBy: cur.lockedBy, lockVersion: cur.lockVersion }, data: { lockVersion: { increment: 1 } } });
    if (count === 1) return { lockedBy: cur.lockedBy, lockVersion: cur.lockVersion + 1 };
  }
  console.error("[ads] guard lock intent CAS kept losing; pausing anyway", { id });
  return null;
}

/** 감시 끄기. 끈 것이 확인되면 true. 어떤 실패도 던지지 않는다. observedOn = 이 실행에서 새로 읽어 켜짐을 봤다. */
export async function guardPause(ctx: GuardCtx, mirrorId: string | null, naverId: string, reason: string, observedOn: boolean): Promise<boolean> {
  let intent: Awaited<ReturnType<typeof bumpIntent>> = null;
  if (mirrorId !== null) {
    try {
      intent = await bumpIntent(mirrorId);
    } catch (error) {
      console.error("[ads] guard lock intent write failed; pausing anyway", { error: errorName(error) });
    }
  }
  const step = `guard.${reason}.${observedOn ? "pre_on" : "pre_unknown"}`;
  const paused = await safetyPause(ctx.account, "campaign", { id: mirrorId, naverId }, step, guardDeps(ctx), { reason, at: "guard" });
  if (paused) ctx.result.paused++;
  else ctx.result.pauseFailed++;
  if (paused && observedOn && mirrorId !== null && intent && (intent.lockedBy === null || intent.lockedBy === "guard")) {
    try {
      await prisma.adCampaign.updateMany({ where: { id: mirrorId, lockVersion: intent.lockVersion }, data: { lockedBy: "guard", lockedAt: ctx.now } });
    } catch (error) {
      console.error("[ads] guard lock tag write failed", { error: errorName(error) });
    }
  }
  return paused;
}

/** 목록에서 못 본 미러 단건 재조회: 'on' | 'off' | 'unknown'. */
async function readOne(ctx: GuardCtx, naverId: string): Promise<"on" | "off" | "unknown"> {
  try {
    const parsed = naverCampaignSchema.safeParse(await readEntity(ctx.client, "campaign", naverId));
    return parsed.success ? (isCampaignOff(parsed.data) ? "off" : "on") : "unknown";
  } catch (error) {
    if (isAuthError(error)) throw error;
    return "unknown";
  }
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
  if (!read?.complete) await guardBlind(ctx, "campaign_list_incomplete");
  const targets = new Map<string, { id: string | null; on: boolean }>();
  for (const c of read?.campaigns ?? []) if (!isCampaignOff(c)) targets.set(c.nccCampaignId, { id: null, on: true });
  const seen = new Set((read?.campaigns ?? []).map((c) => c.nccCampaignId));
  const mirrors = await prisma.adCampaign.findMany({ where: { adAccountId: ctx.account.id }, select: { id: true, naverId: true } });
  let unchecked = 0;
  for (const m of mirrors) {
    const t = targets.get(m.naverId);
    if (t) t.id = m.id;
    else if (!read?.complete && !seen.has(m.naverId)) {
      if (pastDeadline(ctx)) { unchecked++; continue; }
      const state = await readOne(ctx, m.naverId);
      if (state !== "off") targets.set(m.naverId, { id: m.id, on: state === "on" }); // 모르면 끄되 표시하지 않는다
    }
  }
  let paused = 0, pauseFailed = 0, unmirrored = 0;
  for (const [naverId, t] of targets) {
    if (pastDeadline(ctx)) { unchecked++; continue; }
    if (t.id === null) unmirrored++;
    if (await guardPause(ctx, t.id, naverId, "cap_100", t.on)) paused++;
    else pauseFailed++;
  }
  ctx.result.unchecked += unchecked;
  await guardAlert(ctx, "ads.cap_100", { todayCostKrw: spend, dailyCapKrw: cap, paused, pauseFailed, unmirrored, unchecked, listComplete: read?.complete ?? false });
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
