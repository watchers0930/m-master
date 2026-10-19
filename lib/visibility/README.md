# MINTEQ backend

Contract: `docs/02-design/features/minteq.design.md`. All API inputs are validated
in `schemas/visibility.ts`; public DTOs live in `types/visibility.ts`.

## Deployment prerequisites

1. Apply `prisma/manual-migrations/20261019_minteq_visibility.sql` to a test database
   and then review/apply it to the project database before enabling these routes.
   Production was inspected read-only: contents/settings exist, the four new tables,
   market columns and `_prisma_migrations` baseline did not exist at inspection time.
   This project uses manual SQL. Do not reset the database or use migrate reset.
2. Run `prisma generate` after schema changes. The SQL is additive and transactional;
   old Content and Setting rows receive `ko-KR`. Changing a setting does not rewrite history.
   To roll back application behavior, disable the new callers/cron and deploy the prior
   application while retaining the additive schema and all captured data/cost history.
3. Configure `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `OPENAI_API_KEY` (ambiguous
   judgments only), and `CRON_SECRET`. Optional `DATAFORSEO_USD_KRW` defaults to 1400.
   Inject values through deployment secret management; never commit values.
4. Register `/api/cron/visibility-track` in deployment scheduling. A five-minute
   schedule permits task resumption; run keys perform each daily capture once per KST
   day and each weekly capture once per KST Monday bucket. Pending weekly tasks also
   resume after Monday. `vercel.json` was outside the authorized edit paths and was
   not changed. Missing CRON_SECRET is rejected.
5. Verify four-engine paid responses in the target account and a logged-in dashboard
   after migration. Location/language/model metadata were checked against the account;
   paid engine runs, production writes and production UI verification were not performed.

## Capture and cost policy

- At most two engine calls run concurrently. Each engine task has a 45-second external
  I/O budget, four polls, and a 25-second per-request timeout. Pending tasks retain their
  IDs for another invocation. A claim has a five-minute lease; immediate captures have
  a one-minute minimum interval. Run keys use KST; timestamps are stored in UTC.
- User row locks serialize query-limit checks and new capture reservations. Every pending
  engine reserves 1000 KRW against the plan limit and user budget. This is a conservative
  admission reserve, not a vendor-side maximum price. Set and review exchange rates and
  observed provider costs before release. Cost lookup failures block new paid work.
- ChatGPT and Gemini use scraper tasks. AI Overviews uses organic SERP tasks and consumes
  only ai_overview items. Perplexity uses the vendor's LLM Responses live endpoint with
  Sonar; its completed result is checkpointed with its cost. There is no automatic paid
  ChatGPT fallback. The response parser handles the llm_responses sections schema.
- Paid POSTs are never automatically retried. Task creation cost and task ID are committed
  with the visibility ledger entry before polling. Actual costs remain recorded even if
  the query is deleted while an external call is in flight. Result checkpoints allow
  judgment/storage retries without another collection charge.
- An ambiguous submission without a durable task ID/result stays pending and requires
  reconciliation with the vendor task list. It must not be deleted and recreated as an
  automatic retry. Failed checkpoint writes are logged with snapshot IDs only.
- `rawJson` stores the normalized resume checkpoint and the sanitized original vendor
  result payload, excluding authentication headers and vendor request echoes. It is never exposed in list/aggregate responses. This avoids
  retaining credentials and reasoning sections. No external result/credential is logged.
- Judgments use one bounded gpt-4o-mini call per answer, only for ambiguous matches.
  Actual token usage is billed as chat at separate mini rates. Failed judgments and missing
  domain citation targets remain unresolved; they never become negative samples.
- Domain hosts match exactly after IDN normalization. www and subdomains remain distinct.
  Date-only `to` filters include the full UTC date. Aggregation excludes failed/no-result/
  pending/unresolved samples and emits null rates for empty denominators.

## Verification

```sh
node --test lib/visibility/__tests__/*.test.cjs
npx tsc --noEmit --incremental false
npm run build
```

An isolated PostgreSQL-compatible migration test uses PGlite without changing project
runtime dependencies:

```sh
npm install --prefix prisma/.minteq-test-runtime --no-save --package-lock=false @electric-sql/pglite
NODE_PATH=prisma/.minteq-test-runtime/node_modules node --test lib/visibility/__tests__/migration.integration.cjs
rm -rf prisma/.minteq-test-runtime
```

The integration test verifies existing-row defaults, owner/host uniqueness, run-key
uniqueness, scoped deletion, cascade behavior, and preservation of the cost ledger.
Operational gates still pending: paid provider fixtures, actual Neon execution plans,
migration deployment, scheduler registration and authenticated production UI checks.
