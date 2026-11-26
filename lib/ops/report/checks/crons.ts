// lib/ops/report/checks/crons.ts — 크론 생존: 크론마다 마지막 실행(성공·건너뜀)이 기준(lib/cron/schedule.ts)보다 오래되면 이상.
// 근거는 lib/cron/heartbeat.ts의 실행 기록(pipeline_runs kind='cron'). 최근 10일 행만 읽는다(크론당 하루 1행 → 상한 ~110행).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CRON_RUN_KIND, CRON_RUN_OWNER } from "@/lib/cron/heartbeat";
import { CRON_EXPECTATIONS } from "@/lib/cron/schedule";
import { kstDate } from "@/lib/ads/alerts";
import { ago, type CheckContext, type CheckResult } from "../types";

type Row = { scope_key: string; last_run: string | null; last_fail: string | null; last_error: string | null };

export async function checkCrons({ now }: CheckContext, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<CheckResult> {
  const base = { key: "crons", title: "크론(자동 작업) 실행" };
  const fromDay = kstDate(new Date(now.getTime() - 10 * 864e5));
  const rows = await db.$queryRaw<Row[]>`
    SELECT scope_key,
      max(result_ref->>'lastRunAt') AS last_run,
      max(result_ref->>'lastFailAt') AS last_fail,
      (array_agg(result_ref->>'lastError' ORDER BY result_ref->>'lastFailAt' DESC NULLS LAST))[1] AS last_error
    FROM pipeline_runs WHERE kind = ${CRON_RUN_KIND} AND owner_id = ${CRON_RUN_OWNER} AND period_key >= ${fromDay}
    GROUP BY scope_key`;
  const byName = new Map(rows.map((r) => [r.scope_key, r]));
  // 유예 기준 = 실행 기록이 처음 생긴 시각(기록 기능 배포 직후엔 아직 한 번도 안 돈 크론이 정상일 수 있다). 기록이 하나도 없으면 지금.
  const [first] = await db.$queryRaw<{ at: Date | null }[]>`
    SELECT min(started_at) AS at FROM pipeline_runs WHERE kind = ${CRON_RUN_KIND} AND owner_id = ${CRON_RUN_OWNER}`;
  const since = first?.at ?? now;
  let level = "ok" as CheckResult["level"];
  const lines: string[] = [];
  let stopped = 0, failing = 0;
  for (const [name, exp] of Object.entries(CRON_EXPECTATIONS)) {
    const r = byName.get(name);
    const lastRun = r?.last_run ? new Date(r.last_run) : null;
    const lastFail = r?.last_fail ? new Date(r.last_fail) : null;
    const gapMs = exp.maxGapMinutes * 60000;
    // 기록 시작 직후엔 아직 한 번도 안 돈 크론이 정상일 수 있다 — 기준 시간이 지나도 없으면 멈춤.
    const reference = lastRun ?? since;
    const isStopped = now.getTime() - reference.getTime() > gapMs;
    const failedSince = lastFail && (!lastRun || lastFail > lastRun);
    if (isStopped) { level = "error"; stopped++; }
    else if (failedSince) { if (level === "ok") level = "warn"; failing++; }
    if (isStopped || failedSince)
      lines.push(`${exp.label}: 마지막 정상 실행 ${ago(lastRun, now)}${failedSince ? ` · 최근 실패(${r?.last_error ?? "사유 없음"}) ${ago(lastFail, now)}` : ""}${isStopped ? " ⛔멈춤" : ""}`);
  }
  const summary = stopped ? `${stopped}개 크론이 멈췄습니다.` : failing ? `${failing}개 크론의 마지막 실행이 실패했습니다.` : "모든 크론이 기준 안에서 실행 중";
  return { ...base, level, summary, lines };
}
