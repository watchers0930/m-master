// lib/cron/heartbeat.ts — 크론 실행 기록(아침 보고서가 '크론이 실제로 도는가'를 판정하는 근거).
// - 저장소: 기존 pipeline_runs(kind='cron', owner='system:cron', scope=크론 이름, period=KST 날짜) — 크론당 하루 1행을 갱신(DB 구조 변경 없음).
//   result_ref에 lastRunAt(성공·건너뜀)·lastFailAt·lastError를 합쳐 쓴다(jsonb ||). attempts = 그날 실행 횟수.
// - 기록 실패는 크론을 실패시키지 않는다(삼키고 stderr만). 인증을 통과한 실행만 기록한다(호출부가 인증 뒤에 부른다).
// - 2026-11-26 이전엔 지출 감시(ads_guard)만 기록이 있어 SEO 수거·심사 동기화·성과 수집이 멈춰도 알 수 없었다(codex HIGH).
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-time";
import { kstDate } from "@/lib/ads/alerts";

export type CronOutcome = "succeeded" | "skipped" | "failed";
export const CRON_RUN_KIND = "cron";
export const CRON_RUN_OWNER = "system:cron";

/** 요청 경로(/api/cron/<이름>)에서 크론 이름. 형식이 아니면 null(기록 안 함). */
export function cronName(request: Request): string | null {
  const match = /^\/api\/cron\/([a-z0-9-]{1,40})\/?$/.exec(new URL(request.url).pathname);
  return match ? match[1] : null;
}

/** 기록이 응답을 붙잡지 않게 하는 상한(DB가 느려도 크론 응답은 이 시간 안에 나간다 — codex MED). */
export const HEARTBEAT_TIMEOUT_MS = 3000;

/** 이 이름의 숫자 필드는 그 수만큼 실패다(광고 심사·성과의 건너뛴 묶음 skippedBatches, 감시의 끄기 실패 pauseFailed). */
const FAILURE_COUNT_KEYS = new Set(["failed", "skippedBatches", "pauseFailed"]);

function failuresIn(record: Record<string, unknown>): number {
  let n = 0;
  if (record.outcome === "error" || record.error === true || (typeof record.status === "string" && record.status.startsWith("failed"))) n++;
  for (const [key, value] of Object.entries(record)) {
    if (FAILURE_COUNT_KEYS.has(key)) n += typeof value === "number" && value > 0 ? value : key === "failed" && Array.isArray(value) ? value.length : 0;
  }
  return n;
}

/**
 * 작업 결과에서 내부 실패 수를 센다(HTTP 200이어도 안에서 실패할 수 있다 — codex HIGH). 크론들이 쓰는 표현:
 * failed(숫자·배열) · skippedBatches·pauseFailed(광고) · outcome='error'(광고) · error=true(SEO) · status='failed…'(예약 발행 failed_final 포함).
 * 최상위와, 최상위 배열 항목·객체 값(예: 감시 결과의 alerts.failed) 한 단계까지 본다.
 */
export function countFailures(result: unknown): number {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;
  const top = result as Record<string, unknown>;
  let n = 0;
  for (const [key, value] of Object.entries(top)) {
    if (FAILURE_COUNT_KEYS.has(key)) n += typeof value === "number" && value > 0 ? value : key === "failed" && Array.isArray(value) ? value.length : 0;
    else if (Array.isArray(value)) { for (const item of value) if (item && typeof item === "object" && !Array.isArray(item)) n += failuresIn(item as Record<string, unknown>); }
    else if (value && typeof value === "object") n += failuresIn(value as Record<string, unknown>);
  }
  return n;
}

/** 정상 반환된 작업 결과 → 기록할 판정. 내부 실패가 있으면 실패(그날 정상 실행 시각은 갱신하지 않는다). */
export function assessResult(result: unknown): { outcome: CronOutcome; code?: string } {
  const failures = countFailures(result);
  return failures > 0 ? { outcome: "failed", code: `items_failed:${failures}` } : { outcome: "succeeded" };
}

export async function recordCronRun(name: string | null, outcome: CronOutcome, errorCode?: string, now = new Date()): Promise<void> {
  if (!name) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    write(name, outcome, errorCode, now),
    new Promise<void>((resolve) => { timer = setTimeout(() => { console.error("[cron/heartbeat] 기록 시간 초과:", name); resolve(); }, HEARTBEAT_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

async function write(name: string, outcome: CronOutcome, errorCode: string | undefined, now: Date): Promise<void> {
  const at = now.toISOString();
  const patch = outcome === "failed" ? { lastFailAt: at, lastError: (errorCode ?? "failed").slice(0, 60) } : { lastRunAt: at, lastOutcome: outcome };
  try {
    await prisma.$executeRaw`
      INSERT INTO pipeline_runs (id, kind, owner_id, scope_key, period_key, status, lease_until, attempts, result_ref, error_code, started_at, finished_at)
      VALUES (${crypto.randomUUID()}, ${CRON_RUN_KIND}, ${CRON_RUN_OWNER}, ${name}, ${kstDate(now)}, ${outcome}, ${utcTimestamp(now)}, 1,
              ${JSON.stringify(patch)}::jsonb, ${outcome === "failed" ? errorCode ?? "failed" : null}, ${utcTimestamp(now)}, ${utcTimestamp(now)})
      ON CONFLICT (kind, owner_id, scope_key, period_key) DO UPDATE SET
        status = EXCLUDED.status, attempts = pipeline_runs.attempts + 1, finished_at = EXCLUDED.finished_at,
        error_code = EXCLUDED.error_code, result_ref = coalesce(pipeline_runs.result_ref, '{}'::jsonb) || EXCLUDED.result_ref`;
  } catch (error) {
    console.error("[cron/heartbeat] 기록 실패:", name, error instanceof Error ? error.message.slice(0, 120) : "unknown");
  }
}

/** 오류 → 기록용 고정 코드(원문 메시지·키 금지). */
export function outcomeOf(error: unknown): { outcome: CronOutcome; code: string } {
  const code = error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : "internal_error";
  // 자동화 스위치가 꺼져 거부된 실행은 '살아 있음(건너뜀)'이다 — 멈춤으로 보지 않는다.
  return code === "automation_paused" ? { outcome: "skipped", code } : { outcome: "failed", code };
}
