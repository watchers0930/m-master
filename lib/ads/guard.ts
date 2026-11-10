// lib/ads/guard.ts — 하루 상한 사후 감시 크론(설계서 §5.4-4·5, 30분: vercel.json `*/30 * * * *` UTC).
// 상한 4중 강제 중 마지막 층이다. 30분 사이에는 네이버 공유예산(1층)과 쓰기 후 재조회(2층)가 상한을 지키고, 감시는 그 뒤의 안전망이다
// (⚠️ /stats 반영 지연은 미실측 — 설계서 §5.6-1, 운영 1주 실측).
// 2단계(판정 round 2 (a)) — 계정은 take MAX_ACCOUNTS, createdAt 순:
//   1단계(모든 계정 먼저): 0·1·2(비용 측정, cap_90, 상한 끄기). 2단계(1단계가 모든 계정에서 끝난 뒤): 3·4·5(드리프트, 재개, 비즈머니).
//   앞 계정(상한 미만)의 드리프트·재개가 뒤 계정의 상한 끄기 예산을 먹지 않는다.
//   0. status invalid_key → 네이버 호출 없이 건너뛰고 ads.key_invalid(같은 날 1회). disconnecting·disabled는 해제 흐름 소관이라 제외.
//   1. 오늘(KST) 비용 = todayCostKrw(단일 계산: 계정의 모든 캠페인 /stats salesAmt 합, VAT 별도). 모르면 null(끄기·재개 판단 안 함)
//      + ads.guard_blind(reason spend_unknown). 키 복호화·클라이언트 생성 실패도 ads.guard_blind(credential_unavailable·client_unavailable)
//      후 다음 계정으로 간다. 감시 불가만으로 자동 끄기는 하지 않는다(판정: 네이버 공유예산이 여전히 상한).
//   감시 경로의 모든 알림(ads.pause_failed·ads.key_invalid·launch drift 포함) KST 날짜는 주입된 now 기준이다.
//   2. ≥90% → ads.cap_90. ≥100% → 네이버에서 새로 읽은 켜진 캠페인 전부 끄기(guard-cap) + ads.cap_100. guard 표시는 감시가 켜짐을 보고
//      스스로 끄고 확인한 것만(판정 I-1). 목록 조회 실패·불완전 → ads.guard_blind(campaign_list_incomplete).
//   3. 드리프트 검사(guard-drift): 켜진 드리프트 캠페인은 끄고 ads.drift(엔티티별).
//   4. 비용 < 상한이면 어제 이전의 guard 잠금 자동 재개(guard-resume — 전제 전부 재확인, 드리프트면 재개 없음).
//   5. 비즈머니 < 3×상한 → ads.bizmoney_low.
// - 분류 외 계정 예외(상한값 손상·DB 오류 등) → ads.guard_blind(guard_error, code=사유 이름만) 후 다음 계정(판정 I-5). 자동 끄기 없음.
// - 스위치: 끄기는 PIPELINE_AUTOMATION_ENABLED·ADS_EXECUTION_ENABLED와 무관(끄기 전용 클라이언트). 재개만 ADS_EXECUTION_ENABLED==='true'.
// - 401이면 계정을 invalid_key로 바꾸고 ads.key_invalid(분류된 실패 — guard_error는 내지 않는다).
// - 동시 실행: claimPipelineRun(kind 'ads_guard', 30분 칸 periodKey)으로 한 칸에 한 실행만. 임대(lease) 6분(run-claim.ts) < 30분 주기 —
//   죽은 실행의 칸은 6분 뒤 다시 잡을 수 있다(칸당 최대 4회). 다른 칸끼리는 maxDuration(300초) < 30분이라 겹치지 않는다.
//   겹치더라도 미러 CAS(lockedBy, lockVersion)가 잠금·재개 중복을 막는다.
// - 시간 예산(판정 I-4·round 2 (b)(c), maxDuration 300초):
//   네이버 작업 마감 = 시작 + WORK_WINDOW_MS(= RUN_LIMIT_MS 280초 − FLUSH_RESERVE_MS 60초 = 220초, deps.clock 기준).
//   감시의 모든 네이버 호출(비용 측정·목록·끄기 PUT과 재조회·공유예산·드리프트 조회·재개 재측정과 PUT·비즈머니)은 같은 예산 함수
//   (callBudget = 마감 − 지금)를 받은 클라이언트로만 나간다: 남은 예산 ≤ 0이면 호출을 시작하지 않고, 호출 마감 = min(45초, 남은 예산)
//   (시도별 타임아웃·GET 재시도 포함). 그래서 어떤 경로든 네이버 작업은 220초 안에 끝난다 — 확인 없는 구간이 없다.
//   루프(계정·끄기·드리프트·재개)도 마감을 보고, 못 간 엔티티·계정은 '확인 못 함'(unchecked — 재개 안 함) + ads.guard_blind(deadline).
//   발송: 220초 + DB 왕복 뒤 시작, flushAlerts(FLUSH_LIMIT=5) × 1통 상한 10초(SEND_TIMEOUT_MS) = 50초 → 약 270초 + DB < 300초.
//   발송은 계정 루프가 어떻게 끝나든(루프 밖 예외 포함) 언제나 돌고, 그 뒤 예외를 다시 던진다. 안전 유형 먼저.
import type { AdAccount } from "@prisma/client";
import { CredentialCryptoError } from "@/lib/crypto/credentials";
import { NaverAdsError, clientForAccount, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { claimPipelineRun, finishPipelineRun } from "@/lib/pipeline/run-claim";
import { prisma } from "@/lib/prisma";
import { markInvalidKey } from "./account-core";
import type { EmailTransport } from "@/lib/notify/email";
import { flushAlerts, type FlushResult } from "./alerts";
import { checkBizmoney, errorName, guardAlert, guardBlind, lockAtCap, pastDeadline, type GuardAccountResult, type GuardCtx } from "./guard-cap";
import { scanDrift } from "./guard-drift";
import { autoResume } from "./guard-resume";
import { caps } from "./invariants";
import type { LockDeps } from "./lock-mirror";
import { todayCostKrw } from "./spend";

export { kstDayStart } from "./guard-resume";
export type { GuardAccountResult } from "./guard-cap";

export const MAX_ACCOUNTS = 50;
export const FLUSH_LIMIT = 5;
export const RUN_LIMIT_MS = 280_000; // maxDuration 300초 − 여유 20초
export const FLUSH_RESERVE_MS = 60_000; // 발송 몫(판정 round 2: ≥ 60초)
export const WORK_WINDOW_MS = RUN_LIMIT_MS - FLUSH_RESERVE_MS; // 네이버 작업 마감 = 시작 + 220초
const GUARD_RUN = { kind: "ads_guard", ownerId: "system:ads-guard", scopeKey: "all" } as const;

/** clock: 마감 판정 시계(ms). naverClock: 네이버 클라이언트 시계(테스트 주입). budgetMs: 네이버 작업 창(기본 WORK_WINDOW_MS). */
export type GuardDeps = LockDeps & { budgetMs?: number; clock?: () => number; emailTransport?: EmailTransport };
export type GuardSummary = { skipped?: "already_claimed"; accounts: GuardAccountResult[]; alerts: FlushResult | null };

/** 실행 칸 = UTC 30분 단위 'YYYY-MM-DDTHH:00|30'. */
export function guardSlot(now: Date): string {
  const iso = now.toISOString(); // invalid Date는 RangeError
  return `${iso.slice(0, 14)}${Number(iso.slice(14, 16)) < 30 ? "00" : "30"}`;
}

const blank = (account: AdAccount): GuardAccountResult =>
  ({ accountId: account.id, outcome: "ok", todayCostKrw: null, paused: 0, pauseFailed: 0, resumed: 0, blocked: 0, drift: 0, unchecked: 0 });

function reasonOf(error: unknown): string {
  if (error instanceof NaverAdsError) return error.reason;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : errorName(error);
}

/** 이미 알린(분류된) 계정 실패 — 루프의 guard_error 알림을 다시 내지 않는다. */
class ClassifiedFailure extends Error {
  constructor(readonly reason: string) {
    super(`guard_${reason}`);
    this.name = "ClassifiedFailure";
  }
}

type RunClock = { clock: () => number; deadline: number };
type Phase1 = { ctx: GuardCtx; cap: number; spend: number | null };

/** 저장 키로 클라이언트를 만든다(모든 호출에 남은 예산 마감). 실패(복호화·형식)는 감시 불가 알림 후 ClassifiedFailure. */
async function guardClient(account: AdAccount, now: Date, deps: LockDeps): Promise<NaverAdsClient> {
  try {
    return clientForAccount(account, deps.transport, { clock: deps.naverClock, budget: deps.callBudget });
  } catch (error) {
    const reason = error instanceof CredentialCryptoError ? "credential_unavailable" : "client_unavailable";
    await guardBlind({ account, now }, reason);
    throw new ClassifiedFailure(reason);
  }
}

/** 계정 작업 공통 오류 처리: 401 → invalid_key(분류됨). 그 밖은 그대로 던진다(루프가 guard_error로 알린다). */
async function classify<T>(account: AdAccount, deps: LockDeps, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") {
      await markInvalidKey(account.id, deps.now);
      throw new ClassifiedFailure(error.reason);
    }
    throw error;
  }
}

/** 1단계: 비용 측정 + cap_90 + 상한 끄기. 2단계에 넘길 문맥을 돌려준다(키 무효 계정은 null). */
async function phase1(account: AdAccount, now: Date, baseDeps: LockDeps, run: RunClock, result: GuardAccountResult): Promise<Phase1 | null> {
  if (account.status !== "active") {
    await guardAlert({ account, now }, "ads.key_invalid", { naverCustomerId: account.naverCustomerId });
    Object.assign(result, { outcome: "skipped", reason: account.status });
    return null;
  }
  // 감시 경로의 모든 알림 KST 날짜 = 주입 시각, 모든 네이버 호출 = 남은 예산 마감(판정 round 2 (b))
  const deps: LockDeps = { ...baseDeps, now: () => now, callBudget: () => run.deadline - run.clock() };
  const client = await guardClient(account, now, deps);
  const ctx: GuardCtx = { account, client, now, deps, result, ...run };
  return classify(account, deps, async () => {
    const cap = caps(account).dailyCapKrw;
    let spend: number | null = null;
    try {
      spend = await todayCostKrw(account, client, now);
    } catch (error) {
      const unknown = (error as { code?: string }).code === "spend_unknown" || (error instanceof NaverAdsError && error.reason !== "ads_auth_failed");
      if (!unknown) throw error;
      console.error("[ads] guard spend unknown", { accountId: account.id, error: reasonOf(error) });
      await guardBlind(ctx, pastDeadline(ctx) ? "deadline" : "spend_unknown");
    }
    result.todayCostKrw = spend;
    if (spend !== null && spend * 10 >= cap * 9) await guardAlert(ctx, "ads.cap_90", { todayCostKrw: spend, dailyCapKrw: cap });
    if (spend !== null && spend >= cap) await lockAtCap(ctx, spend, cap);
    return { ctx, cap, spend };
  });
}

/** 2단계: 드리프트 → 자동 재개 → 비즈머니. 모든 계정의 1단계가 끝난 뒤에만 돈다. */
async function phase2(p: Phase1): Promise<void> {
  const { ctx, cap, spend } = p;
  await classify(ctx.account, ctx.deps, async () => {
    if (pastDeadline(ctx)) ctx.result.unchecked++; // 2단계를 시작하지 못함 = 드리프트·재개 확인 못 함(재개 안 함)
    else {
      const scan = await scanDrift(ctx);
      if (spend !== null && spend < cap) await autoResume(ctx, scan);
      if (!pastDeadline(ctx)) await checkBizmoney(ctx, cap);
    }
    if (ctx.result.unchecked > 0) await guardBlind(ctx, "deadline", { unchecked: ctx.result.unchecked });
  });
}

/** 계정별 실패 격리: 분류 외 예외 → guard_blind(guard_error, code) 후 계속(판정 I-5). 자동 끄기 없음. */
async function isolate(account: AdAccount, now: Date, result: GuardAccountResult, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    const reason = error instanceof ClassifiedFailure ? error.reason : reasonOf(error);
    console.error("[ads] guard account failed", { accountId: account.id, reason });
    if (!(error instanceof ClassifiedFailure)) await guardBlind({ account, now }, "guard_error", { code: reason });
    Object.assign(result, { outcome: "error", reason });
  }
}

export async function runGuard(now: Date = new Date(), deps: GuardDeps = {}): Promise<GuardSummary> {
  const run = await claimPipelineRun({ ...GUARD_RUN, periodKey: guardSlot(now) });
  if (!run.acquired) return { skipped: "already_claimed", accounts: [], alerts: null };
  const clock = deps.clock ?? Date.now;
  const runClock: RunClock = { clock, deadline: clock() + (deps.budgetMs ?? WORK_WINDOW_MS) };
  const results: GuardAccountResult[] = [];
  let failure: unknown = null;
  try {
    const accounts = await prisma.adAccount.findMany({
      where: { status: { in: ["active", "invalid_key"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ACCOUNTS,
    });
    // 1단계(판정 round 2 (a)): 모든 계정의 비용 측정 + 상한 끄기를 먼저. 앞 계정의 드리프트·재개가 뒤 계정의 끄기를 굶기지 않는다.
    const second: Phase1[] = [];
    for (const account of accounts) {
      const result = blank(account);
      results.push(result);
      if (pastDeadline(runClock)) {
        Object.assign(result, { outcome: "skipped", reason: "time_budget" });
        if (account.status === "active") await guardBlind({ account, now }, "deadline");
        continue;
      }
      await isolate(account, now, result, async () => {
        const p = await phase1(account, now, deps, runClock, result);
        if (p) second.push(p);
      });
    }
    // 2단계: 드리프트·재개·비즈머니(남은 예산 안에서)
    for (const p of second) if (p.ctx.result.outcome === "ok") await isolate(p.ctx.account, now, p.ctx.result, () => phase2(p));
  } catch (error) {
    failure = error;
  }
  // 발송은 계정 루프가 어떻게 끝나든 반드시(판정 I-4, finally와 같음) — 안전 유형 먼저(flushAlerts).
  let alerts: FlushResult | null = null;
  try {
    alerts = await flushAlerts(FLUSH_LIMIT, { transport: deps.emailTransport });
  } catch (error) {
    console.error("[ads] guard alert flush failed", { error: errorName(error) });
  }
  if (failure !== null) {
    await finishPipelineRun(run, "failed", undefined, "guard_error");
    throw failure;
  }
  const count = (o: GuardAccountResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  await finishPipelineRun(run, "succeeded", { ok: count("ok"), skipped: count("skipped"), error: count("error") });
  return { accounts: results, alerts };
}
