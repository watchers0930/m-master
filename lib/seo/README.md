# SEO backend (Phase 2)

Contract: `docs/02-design/features/minteq.design.md`, main Phase 2 section.

## API

All seven methods require the session and use the existing CSRF/envelope helpers.

- `/api/seo/audit`: POST full audit; GET owned detail/history.
- `/api/seo/audit/[id]/resume`: POST `{}` to advance at most two tasks.
- `/api/seo/keywords`: POST bounded research; GET stored metrics.
- `/api/seo/rankings`: POST up to ten keyword/engine combinations; GET stored history.

GET never submits, polls or resumes vendor work. Same runKey/input returns the stored run (200); pending new/resumed runs return 202. POST resume is required to process remaining queued work. Failed/unsupported tasks are isolated; uncertain submissions require vendor reconciliation and are never automatically purchased again.

## Deployment prerequisites (not applied in this change)

1. Compare the existing database schema with Prisma and the additive SQL before application. `IF NOT EXISTS` does not repair mismatched pre-existing tables. The SQL was applied twice only in an in-memory PostgreSQL test database. Production application is outside this task.
2. Verify account-specific fixtures, product-specific supported markets and maximum prices. No paid live verification was performed. The fixture transport uses documented minimal field shapes, not account responses.
3. Set `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_USD_KRW` and `SEO_VERIFIED_PRICING_JSON`. The pricing JSON is an object keyed by operation. Each enabled entry requires `usdPerUnit` (positive, finite, verified USD ceiling), `verifiedAt` (ISO timestamp no older than 30 days), and `markets` (verified market codes). Never copy test prices into deployment.

Units: `onpage_instant` = requested URLs (1–5); `onpage_crawl` = maximum pages (20); `labs_ranked` = maximum rows (100; include request overhead in the ceiling); `keywords_for_site` = one request; `serp_google` and `serp_naver` = one bounded request per keyword/engine. The reserve converts the ceiling into KRW and adds 25% headroom. Missing market verification disables an operation; missing/stale prices block submission. Naver volume is explicitly disabled regardless of configuration because the endpoint contract is unverified.

OnPage never enables JavaScript, browser rendering or resource loading. An unobserved check remains unknown. Structured-data presence and syntax evidence are separate. Ranking caches only accept valid direct SERP observations; Labs never overwrites them. Volumes distinguish zero, missing and range strings; advertising competition is not SEO difficulty.

## Durable execution

Owner row locks serialize quotas/reservations/deletion. Five-minute task leases and claim versions guard worker updates. Confirmed task identity, normalized results and ledger deltas commit atomically. Normalized result checkpoints are limited to 256 KiB and never included in DTOs. Public audit counters are materialized so history reads do not fetch checkpoints.

GEO and SEO share pending reservations. Unsettled remaining SEO reserves are included even after an initial ledger checkpoint, protecting deferred OnPage charges. A zero-cost poll cannot erase prepaid cost. Only confirmed incremental charges are recorded; vendor refunds or unknown charges require explicit reconciliation rather than inferred ledger adjustments. Domain deletion is blocked while work or uncertain charges remain; completed SEO history cascades while the ledger survives. Monthly reservations are counted through durable audit events, so deleting a domain cannot reset the quota.

## Verification

```sh
npx tsc --noEmit --incremental false
node --test lib/visibility/__tests__/*.test.cjs lib/seo/__tests__/*.test.cjs
```

Database integration uses an npm-cached `@electric-sql/pglite-socket` package (no project dependency changes). Set `PGLITE_SOCKET_PACKAGE` to its package directory, then run:

```sh
node --test lib/seo/__tests__/database.integration.cjs
```

The integration test boots an isolated in-memory PostgreSQL instance, applies the additive migration twice and uses the actual generated Prisma client. All vendor HTTP and DNS are stubbed. The unrelated legacy vector column is represented as text only in the test baseline; vector functionality is not tested. This verifies SQL/Prisma behavior, not production connection pooling, query plans, login UI or paid vendor/account compatibility.

Remaining launch checks: account live fixtures/prices, production schema preflight, production-like PostgreSQL concurrency/query plans, and the unverified Naver volume contract. P1 content-recommendation feedback is optional and excluded.
