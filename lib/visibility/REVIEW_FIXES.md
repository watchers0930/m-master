# MINTEQ backend review fixes — 2026-10-19

Scope: HIGH and MED items in `docs/03-analysis/minteq.review-backend.md`.
Frontend files and database schema are unchanged by this fix.

- HIGH / MED-5: `mentionValid` depends on successful brand judgment only;
  `citationValid` depends on successful domain judgment only. Engine and trend
  responses expose `citationValidSamples` separately from `validSamples`.
  Missing domains retain unresolved domain mention metadata without a snapshot
  failure reason. Visibility gap candidates use brand judgment validity.
- MED-1: pending rows without a task ID or normalized checkpoint are terminal
  after the 5 minute capture lease. Budget checks, capture reservation and cron
  sweep these rows to `failed/submission_unrecoverable`, preserving their run keys
  and incurred costs. Scheduled replays never resubmit that run. Known tasks and
  normalized checkpoints remain resumable. A later period or an explicit immediate
  capture can create a new run; an expired submission may still have incurred a
  vendor charge, so failed rows remain available for reconciliation.
- MED-3: cron compares half-open KST calendar ranges on `capturedAt`, using the
  existing `(query_id, captured_at)` index instead of a suffix match on run keys.
  Daily ranges start at KST midnight; weekly ranges start Monday KST midnight.
- MED-4: snapshot API results select public fields explicitly and replace internal
  diagnostic reasons with user messages. Original reasons remain in the database.
- MED-2: scraper and LLM Responses request bodies are intentionally different.
  Official ChatGPT and Gemini scraper endpoints both require `keyword`,
  `location_code`, and `language_code`. `user_prompt`, `model_name`, and
  `web_search` belong to the LLM Responses contract used by Perplexity here.
  No model options or `max_output_tokens` are sent to the scraper endpoints.

Official request contracts:

- https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_post/
- https://docs.dataforseo.com/v3/ai_optimization-gemini-llm_scraper-task_post/

Live verification with the configured DataForSEO account on 2026-10-19:

| Engine | POST envelope / task | GET task | Parsed answer | Citations | Cost KRW |
| --- | --- | --- | --- | --- | --- |
| ChatGPT scraper | 20000 / 20100 | 20000 | 4185 characters | 4 | 1.68 |
| Gemini scraper | 20000 / 20100 | 20000 | 2391 characters | 10 | 1.68 |

Each engine received exactly one paid POST. Pending tasks were resumed with GET.
Sanitized live responses and request bodies are in `__tests__/fixtures/*-scraper-live.json`.
Fixtures omit credentials, task request echoes and task IDs. These calls verify
vendor contracts with local credentials; they do not verify the deployed cron,
production environment variables, or production database.

Regression command: `node --test lib/visibility/__tests__/*.test.cjs`.
Tests cover independent denominators, mixed domain settings, unresolved brand
judgments, domainless gap feedback, lease expiry, task/checkpoint preservation,
owner scoping, KST bucket boundaries, response sanitization, and live fixtures.

Validation completed: 48 regression tests, one PGlite migration test, TypeScript,
scoped ESLint, and the production build passed. PGlite was installed under `/tmp`
for the existing integration harness; repository dependencies were not changed.
