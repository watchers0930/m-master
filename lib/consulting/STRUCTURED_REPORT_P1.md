# Structured consulting P1 backend

Contract: current main P1 section of `docs/02-design/features/minteq.design.md` (appendices are prior contracts).

The existing routes remain in place. Consulting POST now returns `{ data, reused }` with 201/200. New reports use v2; history retains its lightweight projection. V1 detail is parsed with the original strict schema and new sections degrade to preparation states. V2 detail returns the stored sections without querying live source tables or invoking providers.

## Collection and settlement

Discovery in new full/research audits freezes up to 50 Google keywords, ordered by exact volume descending (nulls last), then ID. Three operations are independently reserved in batches of ten with `${location}:${batchIndex}` keys. Demand selects twelve completed months, frozen relative to audit creation; historical Labs has no request date filter. Older returned observations are outside the declared selection period. Missing target months are partial; observed zero remains zero. Application caps (50 keywords, 48 Ads months, 600 demand checkpoint rows) are safety ceilings, not claims about account response lengths. Oversized responses fail explicitly and confirmed charges are preserved.

Plan and claim use the same unit function. Missing market verification skips an operation; verified markets with invalid or expired pricing fail with a separate reason. Budget denial is recorded per operation. No default price or new ledger kind is introduced. Recovery applies checkpoint-only work even after pricing removal. A live identity without a durable result becomes uncertain, retains its hold and is never posted again. Cron collects paid checkpoints and can finish interrupted reservation scheduling; it never executes newly pending paid POSTs. Pending paid work requires the existing explicit resume API and keeps the audit pending until settlement. Cron and explicit resume expire untouched metric plans after 24 hours of inactivity using the existing abandoned-audit policy: pending holds are released, metricScheduling becomes expired, and the audit ends partial/failed. Recent activity, claimed/submitted/uncertain tasks, or pending tasks with vendor identity, charge or checkpoint prevent expiry. Expired plans are never rescheduled.

Writers validate owner/domain/audit/market/Google keyword identity/location before fixed-count batch SQL. Demand updates compare audit creation order. Metric updates use indexed JSONB containment (GIN jsonb_path_ops on seo_tasks.frozen_input) to compare independently completed operations; shared `lastAuditId` or `metricsUpdatedAt` cannot substitute for provenance. Ads monthly observations remain in their own checkpoint, never overwrite demand. `adValue` requires a known supported currency, observed Ads period, and volume/CPC from the same response; no rounding. Unknown currency produces null monetary value. This reference value is not spend, revenue or ROAS.

## Snapshot boundary

`freezeSnapshot` preserves all selected chart evidence, computed sections and source references in a maximum 2 MiB snapshot, separately from the maximum 80,000-byte LLM projection. The actual projection and omissions are stored before hashing. Generated validated strategy is attached to the GTM section in the settlement transaction; it is never an additional LLM call. The idempotency hash covers the pre-generation input, source evidence, deterministic sections, projection and versions, excluding the generated strategy. Completed snapshots are not rewritten by subsequent collection.

Six pure section builders use stored evidence. Summary reports selected keyword search-volume partial sums, missing months and coverage. No zero-filled chart, invented growth rate, category, composite score or organic competitor map is created. Existing GEO mention evidence can be displayed with explicit source. Methodology reports only observed sources.

## Verification / remaining release gates

- Unit and isolated PGlite/actual Prisma tests cover contract validation, fixture normalization, zero/missing/duplicates, reservations, repeated SQL, float preservation, schema drift, ownership, ordering, idempotent settlement, no-purchase recovery and frozen DTO rereads.
- No production DB mutation or paid provider call is part of this implementation. Account fixtures, actual ceilings/units and currency provenance remain deployment gates. The three operations remain disabled without their reviewed entries in existing `SEO_VERIFIED_PRICING_JSON`.
- Apply `prisma/manual-migrations/20261021_minteq_structured_report_p1.sql` only after production preflight/review. No backfill is included. Rollback disables the operations and retains stored data/ledgers and v1 parsing.
- Existing central `prisma/schema.prisma` already exceeded 500 lines (533 before P1). All new/changed TypeScript service, route, schema, type and test files stay below 500 lines. The central Prisma file is the explicitly documented existing exception in the design, and remains over the limit.

Run without production URLs:

```sh
npx tsc --noEmit --incremental false
PGLITE_SOCKET_PACKAGE=/path/to/@electric-sql/pglite-socket node --test lib/visibility/__tests__/*.test.cjs lib/seo/__tests__/*.test.cjs lib/consulting/__tests__/*.test.cjs lib/seo/__tests__/database.integration.cjs
```

Official request/response references (read-only documentation, no account calls):

- https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/
- https://docs.dataforseo.com/v3/dataforseo_labs-google-historical_search_volume-live/
- https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/

Verification report: 누락 — paid account verification and production migration are intentionally outside P1 execution; 위험 — unknown currency disables monetary derivation, missing/stale prices block purchases; 우선순위 — verify account contracts/prices and production schema before enabling operations, address the pre-existing central Prisma file size separately.

Review MED fixes: demand provenance is indexed in memory by exact audit/keyword/location/month/value; consulting POST preserves the existing data envelope with additive reused metadata (201 new, 200 reused). Apply the additive migration before enabling writes; it checks index operator-class drift. Index creation may take a write lock, so schedule production preflight separately. Rollback may drop only seo_tasks_frozen_input_path_idx after reverting the writer; no source data changes are required.

Review verification (2026-10-21): 185 tests passed with zero skips across visibility/SEO/consulting, including isolated Prisma/PGlite integration; TypeScript and changed server TypeScript ESLint checks passed. GIN eligibility was checked with EXPLAIN and sequential scans disabled in the isolated database; this establishes index support only, not production-scale query cost. Production EXPLAIN/lock-duration measurement and deployment remain outstanding release checks. No frontend files were edited for these fixes.
