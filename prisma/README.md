# GA4 pipeline schema

`prisma/schema.prisma` is the canonical schema and a regular file. Default
`npx prisma validate` and `npx prisma generate` work without package changes.

Apply the reviewed SQL in `manual-migrations/20261104_ga4_pipeline.sql` before deployment.
Do not use `db:push` / `prisma db push` in production: Prisma does not model the
partial unique index `publish_claims_active_uq` and may remove it.

The blog worker must implement pending → verify → publish → complete/fail with
claimToken and `x-blog-worker-protocol: claim-v1` on pending requests. Keep `BLOG_PUBLISH_OWNER_IDS` unset until the scripts worker is updated.
One worker deployment = one owner (one Naver session): every worker request carries `x-blog-worker-owner`
(workflow repo variable `BLOG_PUBLISH_OWNER_ID`), which must be in `BLOG_PUBLISH_OWNER_IDS`; the server only issues,
verifies and records that owner's claims. pending/verify obey `PIPELINE_AUTOMATION_ENABLED` (503 when not `true`);
complete/fail are always accepted so a post that already happened is still recorded.
A GA4 property (and stream) can be bound by only one owner (`ga4_property_bound`), since the service account is shared.
Realtime requires an operator configured web stream ID (`bindGa4({stream: ...})`);
a missing stream returns unavailable rather than an unscoped property total.
