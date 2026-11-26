// lib/ops/report/checks/seo.ts — SEO 진단: 마지막 진단, 최근 7일 실패, 과금 대조가 필요한 작업(uncertain),
// 그리고 결과 수거가 멈춘 작업(제출됨·잡힘 상태로 2시간 넘게 안 바뀜 — seo-resume 15분 크론이면 이미 수거됐어야 함, codex HIGH).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-time";
import { ago, type CheckContext, type CheckResult } from "../types";

export const SEO_STUCK_HOURS = 2;
type Last = { status: string; fail_reason: string | null; created_at: Date };
type Counts = { failed7: number; uncertain: number; stuck: number; oldest_stuck: Date | null; open_audits: number; completed_at: Date | null };

export async function checkSeo({ now }: CheckContext, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<CheckResult> {
  const base = { key: "seo", title: "SEO 진단" };
  const since = new Date(now.getTime() - 7 * 864e5);
  const stuckBefore = new Date(now.getTime() - SEO_STUCK_HOURS * 3600000);
  const [last] = await db.$queryRaw<Last[]>`
    SELECT status, fail_reason, created_at FROM seo_audits ORDER BY created_at DESC LIMIT 1`;
  if (!last) return { ...base, level: "info", summary: "진단 기록이 없습니다.", lines: [] };
  const [c] = await db.$queryRaw<Counts[]>`
    SELECT
      (SELECT count(*) FROM seo_audits WHERE status = 'failed' AND created_at >= ${utcTimestamp(since)})::int AS failed7,
      (SELECT count(*) FROM seo_tasks WHERE status = 'uncertain')::int AS uncertain,
      (SELECT count(*) FROM seo_tasks WHERE status IN ('submitted', 'claimed') AND updated_at < ${utcTimestamp(stuckBefore)})::int AS stuck,
      (SELECT min(updated_at) FROM seo_tasks WHERE status IN ('submitted', 'claimed') AND updated_at < ${utcTimestamp(stuckBefore)}) AS oldest_stuck,
      (SELECT count(*) FROM seo_audits WHERE status IN ('pending', 'running', 'partial'))::int AS open_audits,
      (SELECT max(completed_at) FROM seo_audits WHERE status = 'completed') AS completed_at`;
  const lines = [
    `마지막 진단: ${last.status}(${ago(last.created_at, now)})${last.fail_reason ? ` — ${last.fail_reason}` : ""}`,
    `마지막 완료: ${ago(c.completed_at, now)} · 최근 7일 실패 ${c.failed7}건 · 진행 중·부분 완료 진단 ${c.open_audits}건`,
  ];
  let level = "ok" as CheckResult["level"];
  if (c.stuck > 0) {
    level = "error";
    lines.push(`결과 수거가 ${SEO_STUCK_HOURS}시간 넘게 멈춘 작업 ${c.stuck}건(가장 오래된 것 ${ago(c.oldest_stuck, now)}) ⛔`);
  }
  if (c.uncertain > 0) lines.push(`과금 대조가 필요한 작업 ${c.uncertain}건(제출 결과 불확실 — 공급사 기록과 대조 후 정리 필요)`);
  if (level === "ok" && (last.status === "failed" || c.failed7 > 0 || c.uncertain > 0)) level = "warn";
  const summary = level === "error" ? "결과 수거가 멈췄습니다." : level === "warn" ? "실패 또는 정리할 작업이 있습니다." : "정상";
  return { ...base, level, summary, lines };
}
