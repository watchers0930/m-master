-- Additive SEO migration. Compare existing structure before applying. Production application is out of scope.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "seo_audits" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ko-KR',
    "scope" TEXT NOT NULL,
    "mode" TEXT,
    "technical_score" INTEGER,
    "score_version" TEXT NOT NULL DEFAULT 'v1',
    "coverage" DOUBLE PRECISION,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "run_key" TEXT NOT NULL,
    "config_hash" TEXT NOT NULL,
    "frozen_config" JSONB NOT NULL,
    "cost_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "seo_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "seo_keywords" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "normalized_keyword" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ko-KR',
    "engine" TEXT NOT NULL,
    "search_volume" INTEGER,
    "volume_source" TEXT,
    "volume_scale" TEXT,
    "volume_period" TEXT,
    "competition" DOUBLE PRECISION,
    "competition_raw" TEXT,
    "rank" INTEGER,
    "rank_status" TEXT,
    "rank_source" TEXT,
    "rank_observed_at" TIMESTAMP(3),
    "metrics_updated_at" TIMESTAMP(3),
    "last_audit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "seo_rankings" (
    "id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ko-KR',
    "engine" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'desktop',
    "rank" INTEGER,
    "rank_absolute" INTEGER,
    "matched_url" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_observed_at" TIMESTAMP(3),
    "depth" INTEGER,
    "requested_pages" INTEGER,
    "returned_range" INTEGER,
    "run_key" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_rankings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "seo_tasks" (
    "id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "run_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "frozen_input" JSONB NOT NULL,
    "vendor_task_id" TEXT,
    "result_checkpoint" JSONB,
    "cost_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ledger_recorded_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "claim_version" INTEGER NOT NULL DEFAULT 0,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_tasks_pkey" PRIMARY KEY ("id")
);

-- Also upgrades an already applied version of this additive migration.
ALTER TABLE "seo_keywords" ADD COLUMN IF NOT EXISTS "reservation_only" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "seo_rankings" ADD COLUMN IF NOT EXISTS "domain_id" TEXT;
UPDATE "seo_rankings" r SET "domain_id" = a."domain_id"
FROM "seo_audits" a WHERE a."id" = r."audit_id" AND r."domain_id" IS NULL;
ALTER TABLE "seo_rankings" ALTER COLUMN "domain_id" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "seo_rankings_domain_id_captured_at_id_idx"
 ON "seo_rankings"("domain_id", "captured_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "seo_audits_domain_id_created_at_id_idx" ON "seo_audits"("domain_id", "created_at" DESC, "id");

CREATE UNIQUE INDEX IF NOT EXISTS "seo_audits_domain_id_run_key_key" ON "seo_audits"("domain_id", "run_key");

CREATE INDEX IF NOT EXISTS "seo_keywords_domain_id_market_engine_idx" ON "seo_keywords"("domain_id", "market", "engine");

CREATE UNIQUE INDEX IF NOT EXISTS "seo_keywords_domain_id_market_engine_normalized_keyword_key" ON "seo_keywords"("domain_id", "market", "engine", "normalized_keyword");

CREATE INDEX IF NOT EXISTS "seo_rankings_keyword_id_captured_at_id_idx" ON "seo_rankings"("keyword_id", "captured_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "seo_rankings_audit_id_idx" ON "seo_rankings"("audit_id");

CREATE UNIQUE INDEX IF NOT EXISTS "seo_rankings_keyword_id_audit_id_source_device_key" ON "seo_rankings"("keyword_id", "audit_id", "source", "device");

CREATE INDEX IF NOT EXISTS "seo_tasks_owner_id_status_lease_until_idx" ON "seo_tasks"("owner_id", "status", "lease_until");

CREATE INDEX IF NOT EXISTS "seo_tasks_audit_id_idx" ON "seo_tasks"("audit_id");

CREATE UNIQUE INDEX IF NOT EXISTS "seo_tasks_audit_id_operation_item_key_key" ON "seo_tasks"("audit_id", "operation", "item_key");

CREATE UNIQUE INDEX IF NOT EXISTS "seo_tasks_vendor_task_id_key" ON "seo_tasks"("vendor_task_id");

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_audits_domain_id_fkey' AND conrelid = '"seo_audits"'::regclass) THEN
  ALTER TABLE "seo_audits" ADD CONSTRAINT "seo_audits_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_keywords_domain_id_fkey' AND conrelid = '"seo_keywords"'::regclass) THEN
  ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_rankings_keyword_id_fkey' AND conrelid = '"seo_rankings"'::regclass) THEN
  ALTER TABLE "seo_rankings" ADD CONSTRAINT "seo_rankings_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "seo_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_rankings_audit_id_fkey' AND conrelid = '"seo_rankings"'::regclass) THEN
  ALTER TABLE "seo_rankings" ADD CONSTRAINT "seo_rankings_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "seo_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_tasks_audit_id_fkey' AND conrelid = '"seo_tasks"'::regclass) THEN
  ALTER TABLE "seo_tasks" ADD CONSTRAINT "seo_tasks_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "seo_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

COMMIT;
