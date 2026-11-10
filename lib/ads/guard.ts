// lib/ads/guard.ts — 하루 상한 사후 감시 크론(설계서 §5.4-4·5, 30분: vercel.json `*/30 * * * *` UTC).
// 상한 4중 강제 중 마지막 층이다. 30분 사이에는 네이버 공유예산(1층)과 쓰기 후 재조회(2층)가 상한을 지키고, 감시는 그 뒤의 안전망이다
// (⚠️ /stats 반영 지연은 미실측 — 설계서 §5.6-1, 운영 1주 실측).
// 계정마다(상한 take MAX_ACCOUNTS, createdAt 순):
//   0. status invalid_key → 네이버 호출 없이 건너뛰고 ads.key_invalid(같은 날 1회). disconnecting·disabled는 해제 흐름 소관이라 제외.
//   1. 오늘(KST) 비용 = todayCostKrw(단일 계산: 계정의 모든 캠페인 /stats salesAmt 합, VAT 별도). 모르면 null(끄기·재개 판단 안 함)
//      + ads.guard_blind(reason spend_unknown). 키 복호화·클라이언트 생성 실패도 ads.guard_blind(credential_unavailable·client_unavailable)
//      후 다음 계정으로 간다. 감시 불가만으로 자동 끄기는 하지 않는다(판정: 네이버 공유예산이 여전히 상한).
//   감시 경로의 모든 알림(ads.pause_failed·ads.key_invalid·launch drift 포함) KST 날짜는 주입된 now 기준이다.
//   2. ≥90% → ads.cap_90. ≥100% → 네이버에서 새로 읽은 켜진 캠페인 전부 guard로 끄기(guard-cap) + ads.cap_100.
//   3. 드리프트 검사(guard-drift): 켜진 드리프트 캠페인은 끄고 ads.drift.
//   4. 비용 < 상한이면 어제 이전의 guard 잠금 자동 재개(guard-resume — 전제 전부 재확인, 드리프트면 재개 없음).
//   5. 비즈머니 < 3×상한 → ads.bizmoney_low.
//   마지막에 flushAlerts(FLUSH_LIMIT).
// - 스위치: 끄기는 PIPELINE_AUTOMATION_ENABLED·ADS_EXECUTION_ENABLED와 무관(끄기 전용 클라이언트). 재개만 ADS_EXECUTION_ENABLED==='true'.
// - 한 계정의 실패는 루프를 멈추지 않는다(사유 코드만 기록, 키·본문 없음). 401이면 withAccountClient가 invalid_key로 바꾼다.
// - 동시 실행: claimPipelineRun(kind 'ads_guard', 30분 칸 periodKey)으로 한 칸에 한 실행만. 임대(lease) 6분(run-claim.ts) < 30분 주기 —
//   죽은 실행의 칸은 6분 뒤 다시 잡을 수 있다(칸당 최대 4회). 다른 칸끼리는 maxDuration(300초) < 30분이라 겹치지 않는다.
//   겹치더라도 미러 CAS(lockedBy, lockVersion)가 잠금·재개 중복을 막는다.
// - 시간 예산(maxDuration 300초): 계정 처리는 시작 후 ACCOUNT_BUDGET_MS(170초)가 지나면 남은 계정을 다음 실행으로 미룬다(skipped time_budget).
//   알림 발송은 1통 상한 10초(SEND_TIMEOUT_MS) × FLUSH_LIMIT(10) ≈ 100초 + DB → 170 + 100 < 300. 진행 중인 한 계정의 네이버 조회(GET 상한 45초)는
//   끊지 않으므로 최악에는 넘을 수 있다 — 넘으면 남은 알림은 다음 실행이 보낸다(대기열에 남음).
import type { AdAccount } from "@prisma/client";
import { CredentialCryptoError } from "@/lib/crypto/credentials";
import { NaverAdsError, clientForAccount, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { claimPipelineRun, finishPipelineRun } from "@/lib/pipeline/run-claim";
import { prisma } from "@/lib/prisma";
import { markInvalidKey } from "./account-core";
import { flushAlerts, type FlushResult } from "./alerts";
import { checkBizmoney, errorName, guardAlert, lockAtCap, type GuardAccountResult, type GuardCtx } from "./guard-cap";
import { scanDrift } from "./guard-drift";
import { autoResume } from "./guard-resume";
import { caps } from "./invariants";
import type { LockDeps } from "./lock-mirror";
import { todayCostKrw } from "./spend";

export { kstDayStart } from "./guard-resume";
export type { GuardAccountResult } from "./guard-cap";

export const MAX_ACCOUNTS = 50;
export const FLUSH_LIMIT = 10;
export const ACCOUNT_BUDGET_MS = 170_000;
const GUARD_RUN = { kind: "ads_guard", ownerId: "system:ads-guard", scopeKey: "all" } as const;

export type GuardDeps = LockDeps & { budgetMs?: number };
export type GuardSummary = { skipped?: "already_claimed"; accounts: GuardAccountResult[]; alerts: FlushResult | null };

/** 실행 칸 = UTC 30분 단위 'YYYY-MM-DDTHH:00|30'. */
export function guardSlot(now: Date): string {
  const iso = now.toISOString(); // invalid Date는 RangeError
  return `${iso.slice(0, 14)}${Number(iso.slice(14, 16)) < 30 ? "00" : "30"}`;
}

const blank = (account: AdAccount): GuardAccountResult =>
  ({ accountId: account.id, outcome: "ok", todayCostKrw: null, paused: 0, pauseFailed: 0, resumed: 0, blocked: 0, drift: 0 });

function reasonOf(error: unknown): string {
  if (error instanceof NaverAdsError) return error.reason;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : errorName(error);
}

/** 감시 불가 알림(계정·KST 날짜당 1회). 자동 끄기는 하지 않는다 — 네이버 공유예산(1층)이 여전히 상한이다. 비밀값 없음. */
async function blindAlert(account: AdAccount, now: Date, reason: string): Promise<void> {
  await guardAlert({ account, now }, "ads.guard_blind", { reason, dailyCapKrw: account.dailyCapKrw, sharedBudgetKrw: account.sharedBudgetKrw });
}

/** 저장 키로 클라이언트를 만든다. 실패(복호화·형식)는 감시 불가 알림 후 다시 던진다(호출자가 다음 계정으로 계속). */
async function guardClient(account: AdAccount, now: Date, deps: LockDeps): Promise<NaverAdsClient> {
  try {
    return clientForAccount(account, deps.transport);
  } catch (error) {
    await blindAlert(account, now, error instanceof CredentialCryptoError ? "credential_unavailable" : "client_unavailable");
    throw error;
  }
}

async function guardAccount(account: AdAccount, now: Date, baseDeps: LockDeps): Promise<GuardAccountResult> {
  const result = blank(account);
  if (account.status !== "active") {
    await guardAlert({ account, now }, "ads.key_invalid", { naverCustomerId: account.naverCustomerId });
    return { ...result, outcome: "skipped", reason: account.status };
  }
  const deps: LockDeps = { ...baseDeps, now: () => now }; // 감시 경로의 모든 알림 KST 날짜 = 주입 시각
  const client = await guardClient(account, now, deps);
  const ctx: GuardCtx = { account, client, now, deps, result };
  try {
    const cap = caps(account).dailyCapKrw;
    let spend: number | null = null;
    try {
      spend = await todayCostKrw(account, client, now);
    } catch (error) {
      const unknown = (error as { code?: string }).code === "spend_unknown" || (error instanceof NaverAdsError && error.reason !== "ads_auth_failed");
      if (!unknown) throw error;
      console.error("[ads] guard spend unknown", { accountId: account.id, error: reasonOf(error) });
      await blindAlert(account, now, "spend_unknown");
    }
    result.todayCostKrw = spend;
    if (spend !== null && spend * 10 >= cap * 9) await guardAlert(ctx, "ads.cap_90", { todayCostKrw: spend, dailyCapKrw: cap });
    if (spend !== null && spend >= cap) await lockAtCap(ctx, spend, cap);
    const scan = await scanDrift(ctx);
    if (spend !== null && spend < cap) await autoResume(ctx, scan);
    await checkBizmoney(ctx, cap);
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") await markInvalidKey(account.id, deps.now);
    throw error;
  }
  return result;
}

export async function runGuard(now: Date = new Date(), deps: GuardDeps = {}): Promise<GuardSummary> {
  const run = await claimPipelineRun({ ...GUARD_RUN, periodKey: guardSlot(now) });
  if (!run.acquired) return { skipped: "already_claimed", accounts: [], alerts: null };
  const started = Date.now();
  const budgetMs = deps.budgetMs ?? ACCOUNT_BUDGET_MS;
  const results: GuardAccountResult[] = [];
  try {
    const accounts = await prisma.adAccount.findMany({
      where: { status: { in: ["active", "invalid_key"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ACCOUNTS,
    });
    for (const account of accounts) {
      if (Date.now() - started > budgetMs) {
        results.push({ ...blank(account), outcome: "skipped", reason: "time_budget" });
        continue;
      }
      try {
        results.push(await guardAccount(account, now, deps));
      } catch (error) {
        const reason = reasonOf(error);
        console.error("[ads] guard account failed", { accountId: account.id, reason });
        results.push({ ...blank(account), outcome: "error", reason });
      }
    }
    let alerts: FlushResult | null = null;
    try {
      alerts = await flushAlerts(FLUSH_LIMIT);
    } catch (error) {
      console.error("[ads] guard alert flush failed", { error: errorName(error) });
    }
    const count = (o: GuardAccountResult["outcome"]) => results.filter((r) => r.outcome === o).length;
    await finishPipelineRun(run, "succeeded", { ok: count("ok"), skipped: count("skipped"), error: count("error") });
    return { accounts: results, alerts };
  } catch (error) {
    await finishPipelineRun(run, "failed", undefined, "guard_error");
    throw error;
  }
}
