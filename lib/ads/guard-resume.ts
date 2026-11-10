// lib/ads/guard-resume.ts — 가드 잠금의 다음 날 자동 재개(설계서 §5.4-5 사용자 결정: KST 0시 이후 첫 감시 실행, lockedBy='guard'만).
// '승인 없이 네이버 상태 변경' 반목표의 유일한 예외다. 그래서 전제를 하나라도 확인 못 하면 켜지 않는다(fail-closed):
//   ① 대상 = 미러 캠페인 lockedBy='guard' AND lockedAt < 오늘 KST 0시(lockedAt 없음·미래 = 오늘로 보아 제외). owner·pending_launch는 절대 아님.
//   ② 재개는 쓰기다: ADS_EXECUTION_ENABLED==='true'(putUserLock이 보내기 직전에 다시 확인) + 계정 status==='active'(같음).
//   ③ 오늘 비용(todayCostKrw, 직전 재측정) < dailyCapKrw. 모르면(spend_unknown) 재개 없음.
//   ④ 이번 실행의 드리프트 검사(guard-drift)에서 공유예산·캠페인·모든 그룹이 통과(clean)한 캠페인만. 드리프트면 재개하지 않고 알림(검사가 보냄).
//   ⑤ 보내기 직전 엔티티와 상위를 다시 읽어 대조(launch-check freshCheck — 불일치면 ads.drift 알림 + 재개 없음).
//   ⑥ 미러 CAS (lockedBy='guard', lockVersion) → lockedBy=null, lockVersion+1. 진 경우(그 사이 대장이 바꿈) 건너뛴다.
//   ⑦ PUT buildResume(campaign, id, 'guard_auto_resume'). 실패면 ⑥을 되돌린다(불확실이면 안전 끄기도).
//   ⑧ PUT 뒤 계정 상태 재확인: active가 아니면 즉시 끄기 전용 클라이언트로 다시 끄고 ads.pause_failed(resume_race) (Task 9 adv I-3 패턴).
//   ⑨ 결과 기록은 lockVersion이 ⑥ 값 그대로일 때만. 아니면 안전 방향으로 다시 끈다(lock_race).
// - 켠 것이 있으면 ads.auto_resume 1건/계정(같은 날 중복 제거).
import type { AdsHttpError } from "./http";
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { kstDate } from "./alerts";
import { isExecutionEnabled, putUserLock } from "./execution";
import { errorName, guardAlert, guardDeps, isAuthError, type GuardCtx } from "./guard-cap";
import type { DriftScan } from "./guard-drift";
import { caps } from "./invariants";
import { freshCheck } from "./launch-check";
import { MIRROR_SELECT, mirrorOf, type MirrorLockRow } from "./lock-mirror";
import { pauseAlert, safetyPause } from "./lock-pause";
import { todayCostKrw } from "./spend";

export const MAX_RESUME = 50;
const KST_OFFSET_MS = 9 * 60 * 60_000;

/** 그 시각이 속한 KST 날짜의 0시(UTC Date). */
export function kstDayStart(now: Date): Date {
  return new Date(Date.parse(`${kstDate(now)}T00:00:00Z`) - KST_OFFSET_MS);
}

const isSpendUnknown = (error: unknown) => (error as AdsHttpError | null)?.code === "spend_unknown" || (error instanceof NaverAdsError && !isAuthError(error));

async function resumeOne(ctx: GuardCtx, row: MirrorLockRow): Promise<boolean> {
  const { account, client, now } = ctx;
  const deps = guardDeps(ctx);
  const mirror = mirrorOf(prisma, "campaign");
  try {
    await freshCheck(client, account, "campaign", row, mirror, deps.now); // ⑤
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error("[ads] guard auto-resume blocked by fresh check", { accountId: account.id, error: (error as AdsHttpError).code ?? errorName(error) });
    return false;
  }
  const claimed = row.lockVersion + 1;
  const { count } = await mirror.updateMany({ // ⑥
    where: { id: row.id, lockedBy: "guard", lockVersion: row.lockVersion }, data: { lockedBy: null, lockedAt: now, lockVersion: { increment: 1 } },
  });
  if (count !== 1) return false;
  let stored;
  try {
    stored = await putUserLock(client, account, "campaign", row.naverId, false, { step: "guard.auto_resume", reason: "guard_auto_resume" }); // ⑦
  } catch (error) {
    await mirror.updateMany({ where: { id: row.id, lockVersion: claimed }, data: { lockedBy: "guard", lockedAt: row.lockedAt, lockVersion: { increment: 1 } } });
    if (error instanceof NaverAdsError && error.reason === "ads_uncertain")
      await safetyPause(account, "campaign", row, "guard.resume_uncertain_pause", deps, { reason: "resume_uncertain" });
    if (isAuthError(error)) throw error;
    console.error("[ads] guard auto-resume PUT failed", { accountId: account.id, error: (error as AdsHttpError).code ?? errorName(error) });
    return false;
  }
  const current = await prisma.adAccount.findFirst({ where: { id: account.id, ownerId: account.ownerId }, select: { status: true } }); // ⑧
  if (current?.status !== "active") {
    await mirror.updateMany({ where: { id: row.id }, data: { lockedBy: "guard", lockedAt: now, lockVersion: { increment: 1 } } });
    const paused = await safetyPause(account, "campaign", row, "guard.resume_race_pause", deps, { reason: "resume_race" });
    if (paused) await pauseAlert(account, { reason: "resume_race", entity: "campaign", naverId: row.naverId, paused: true }, deps.now);
    return false;
  }
  const recorded = await mirror.updateMany({ where: { id: row.id, lockVersion: claimed }, data: { userLock: stored.userLock } }); // ⑨
  if (recorded.count !== 1) {
    await safetyPause(account, "campaign", row, "guard.race_pause", deps, { reason: "lock_race" });
    return false;
  }
  return true;
}

export async function autoResume(ctx: GuardCtx, scan: DriftScan): Promise<void> {
  const rows = await prisma.adCampaign.findMany({
    where: { adAccountId: ctx.account.id, lockedBy: "guard", lockedAt: { lt: kstDayStart(ctx.now) } }, // ①
    select: MIRROR_SELECT, orderBy: { lockedAt: "asc" }, take: MAX_RESUME,
  });
  if (rows.length === 0) return;
  if (!isExecutionEnabled()) { // ②
    ctx.result.blocked += rows.length;
    return;
  }
  let spend: number;
  try {
    spend = await todayCostKrw(ctx.account, ctx.client, ctx.now); // ③
  } catch (error) {
    if (!isSpendUnknown(error)) throw error;
    ctx.result.blocked += rows.length;
    return;
  }
  if (spend >= caps(ctx.account).dailyCapKrw) {
    ctx.result.blocked += rows.length;
    return;
  }
  const resumed: string[] = [];
  for (const row of rows) {
    if (!scan.budgetOk || !scan.clean.has(row.naverId) || !(await resumeOne(ctx, row))) { // ④
      ctx.result.blocked++;
      continue;
    }
    resumed.push(row.naverId);
  }
  ctx.result.resumed += resumed.length;
  if (resumed.length) await guardAlert(ctx, "ads.auto_resume", { resumed: resumed.length, naverIds: resumed.slice(0, 10) });
}
