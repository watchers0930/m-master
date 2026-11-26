// lib/ops/report/checks/geo.ts — GEO(AI 노출 추적): 활성 질문×엔진마다 마지막 수집을 보고, 주기(매일 2일·주 1회 8일)를 넘긴 쌍을 멈춤으로 센다.
// - 질문별로 본다(다른 질문·비활성 질문의 성공이 멈춘 질문을 가리지 않게 — codex MED).
// - 첫 수집 전 질문은 생성 시각부터 잰다(등록 직후 '멈춤' 오판 방지). 수집 기록이 아예 없는 쌍은 최근 실패가 있으면 이상(시도하나 계속 실패),
//   실패도 없으면 주의 — 기존 질문에 엔진을 나중에 추가하면 추가 시각을 알 수 없어서다(2026-11-26 '전세사기대응'에 네이버 추가 사례).
// - 스냅샷은 (query_id, captured_at) 인덱스로만 읽는다(활성 질문 id + 최근 60일).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-time";
import { type CheckContext, type CheckResult } from "../types";

export const GEO_GAP_DAYS = { daily: 2, weekly: 8 } as const;
const ENGINE_KO: Record<string, string> = {
  chatgpt: "ChatGPT", ai_overviews: "AI 개요", perplexity: "Perplexity", gemini: "Gemini", naver_ai_briefing: "네이버 AI 브리핑",
};
type Row = { engine: string; pairs: number; stale: number; never: number; ok: number; no_result: number; failed: number; top_reason: string | null };

export async function checkGeo({ now }: CheckContext, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<CheckResult> {
  const base = { key: "geo", title: "GEO(AI 답변 노출 추적)" };
  const since = new Date(now.getTime() - 7 * 864e5);
  const horizon = new Date(now.getTime() - 60 * 864e5);
  const daily = new Date(now.getTime() - GEO_GAP_DAYS.daily * 864e5);
  const weekly = new Date(now.getTime() - GEO_GAP_DAYS.weekly * 864e5);
  const rows = await db.$queryRaw<Row[]>`
    WITH pairs AS (
      SELECT q.id, q.created_at, q.frequency, e.engine
      FROM visibility_queries q CROSS JOIN LATERAL unnest(q.engines) AS e(engine) WHERE q.active
    ), last AS (
      SELECT p.engine, p.frequency, p.created_at,
        (SELECT max(s.captured_at) FROM visibility_snapshots s WHERE s.query_id = p.id AND s.engine = p.engine
           AND s.status IN ('ok', 'no_result') AND s.captured_at >= ${utcTimestamp(horizon)}) AS last_ok,
        EXISTS (SELECT 1 FROM visibility_snapshots s WHERE s.query_id = p.id AND s.engine = p.engine
           AND s.status = 'failed' AND s.captured_at >= ${utcTimestamp(since)}) AS failing,
        -- 조회 범위(60일) 밖에라도 성공이 있었으면 '첫 수집 전'이 아니라 장기 정지다(codex MED).
        EXISTS (SELECT 1 FROM visibility_snapshots s WHERE s.query_id = p.id AND s.engine = p.engine
           AND s.status IN ('ok', 'no_result') AND s.captured_at < ${utcTimestamp(horizon)}) AS ok_before,
        CASE WHEN p.frequency = 'daily' THEN ${utcTimestamp(daily)} ELSE ${utcTimestamp(weekly)} END AS due_before
      FROM pairs p
    ), recent AS (
      SELECT s.engine, s.status, s.fail_reason FROM visibility_snapshots s
      WHERE s.query_id IN (SELECT DISTINCT id FROM pairs) AND s.captured_at >= ${utcTimestamp(since)}
    )
    SELECT l.engine, count(*)::int AS pairs,
      count(*) FILTER (WHERE (l.last_ok IS NOT NULL AND l.last_ok < l.due_before)
        OR (l.last_ok IS NULL AND l.created_at < l.due_before AND (l.failing OR l.ok_before)))::int AS stale,
      count(*) FILTER (WHERE l.last_ok IS NULL AND l.created_at < l.due_before AND NOT l.failing AND NOT l.ok_before)::int AS never,
      (SELECT count(*) FROM recent r WHERE r.engine = l.engine AND r.status = 'ok')::int AS ok,
      (SELECT count(*) FROM recent r WHERE r.engine = l.engine AND r.status = 'no_result')::int AS no_result,
      (SELECT count(*) FROM recent r WHERE r.engine = l.engine AND r.status = 'failed')::int AS failed,
      (SELECT mode() WITHIN GROUP (ORDER BY r.fail_reason) FROM recent r WHERE r.engine = l.engine AND r.status = 'failed') AS top_reason
    FROM last l GROUP BY l.engine ORDER BY l.engine`;
  if (!rows.length) return { ...base, level: "info", summary: "활성 질문이 없습니다.", lines: [] };
  let level = "ok" as CheckResult["level"];
  const lines = rows.map((r) => {
    if (r.stale > 0) level = "error";
    else if ((r.failed > 0 || r.never > 0) && level === "ok") level = "warn";
    const failed = r.failed ? ` · 실패 ${r.failed}(${r.top_reason ?? "사유 없음"})` : "";
    const stale = r.stale ? ` · ⛔주기 넘김 ${r.stale}/${r.pairs}개 질문` : "";
    const never = r.never ? ` · 수집 기록 없음 ${r.never}개 질문(엔진 추가 직후면 다음 수집 때 해소)` : "";
    return `${ENGINE_KO[r.engine] ?? r.engine}: 7일 성공 ${r.ok}·미노출 ${r.no_result}${failed}${stale}${never}`;
  });
  const staleTotal = rows.reduce((n, r) => n + r.stale, 0);
  const summary =
    level === "error" ? `수집 주기를 넘긴 질문·엔진 ${staleTotal}건이 있습니다.` :
    level === "warn" ? "최근 실패 또는 수집 기록이 없는 질문이 있습니다." : `${rows.length}개 엔진 정상 수집 중`;
  return { ...base, level, summary, lines };
}
