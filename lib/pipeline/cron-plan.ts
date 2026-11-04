/**
 * Intended Vercel cron entries for the GA4 content pipeline (single source of truth; copy into vercel.json
 * `crons`). Schedules are UTC (KST = UTC+9). Every job is resumable/idempotent per period, so repeats only
 * pick up owners/items not finished yet (pipeline_runs claim + RESUMABLE_SKIPS + MAX_AUTO_ATTEMPTS):
 *  - strategy: one invocation fits ~1–2 owners (generateReport needs 210s of a 240s budget) → repeat
 *    every 10 min during Mon 00:00–05:59 KST (36 runs ≈ 36–72 owners/week; widen the window as owners grow).
 *  - topics (weekly plan): after strategy, Mon 06:00–08:59 KST, every 10 min; reuses an existing ContentPlan.
 *  - generate: daily items scheduled for today, 09:00–11:59 KST every 15 min (per-item/day claim).
 *  - publish: due schedule slots every 15 min (failed social slots stop after MAX_SLOT_RETRIES).
 * All require CRON_SECRET and PIPELINE_AUTOMATION_ENABLED=true (lib/pipeline/http.ts).
 */
export const PIPELINE_CRONS = [
  { path: '/api/cron/strategy-refresh', schedule: '*/10 15-20 * * 0' },
  { path: '/api/cron/topics-refresh', schedule: '*/10 21-23 * * 0' },
  { path: '/api/cron/content-generate', schedule: '*/15 0-2 * * *' },
  { path: '/api/cron/schedule-publish', schedule: '*/15 * * * *' },
] as const;
