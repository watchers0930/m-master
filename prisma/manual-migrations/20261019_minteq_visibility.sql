-- Additive migration; review on a disposable database before production.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "market" TEXT NOT NULL DEFAULT 'ko-KR';

-- AlterTable
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "default_market" TEXT NOT NULL DEFAULT 'ko-KR';

-- CreateTable
CREATE TABLE IF NOT EXISTS "domains" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ko-KR',
    "business_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visibility_queries" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "domain_id" TEXT,
    "query" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ko-KR',
    "engines" TEXT[],
    "brand_aliases" TEXT[],
    "competitor_aliases" TEXT[],
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visibility_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visibility_snapshots" (
    "id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "source" TEXT,
    "task_id" TEXT,
    "run_key" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answer_text" TEXT NOT NULL DEFAULT '',
    "citations" JSONB NOT NULL DEFAULT '[]',
    "raw_json" JSONB,
    "cost_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fail_reason" TEXT,

    CONSTRAINT "visibility_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visibility_mentions" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL,
    "cited" BOOLEAN NOT NULL,
    "position" INTEGER,
    "sentiment" TEXT,
    "resolvable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "visibility_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "domains_owner_id_idx" ON "domains"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "domains_owner_id_url_key" ON "domains"("owner_id", "url");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visibility_queries_owner_id_idx" ON "visibility_queries"("owner_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visibility_queries_domain_id_idx" ON "visibility_queries"("domain_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visibility_queries_active_frequency_idx" ON "visibility_queries"("active", "frequency");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visibility_snapshots_query_id_captured_at_idx" ON "visibility_snapshots"("query_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visibility_snapshots_query_id_engine_run_key_key" ON "visibility_snapshots"("query_id", "engine", "run_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visibility_mentions_snapshot_id_idx" ON "visibility_mentions"("snapshot_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domains_owner_id_fkey' AND conrelid = '"domains"'::regclass) THEN
    ALTER TABLE "domains" ADD CONSTRAINT "domains_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_queries_owner_id_fkey' AND conrelid = '"visibility_queries"'::regclass) THEN
    ALTER TABLE "visibility_queries" ADD CONSTRAINT "visibility_queries_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_queries_domain_id_fkey' AND conrelid = '"visibility_queries"'::regclass) THEN
    ALTER TABLE "visibility_queries" ADD CONSTRAINT "visibility_queries_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_snapshots_query_id_fkey' AND conrelid = '"visibility_snapshots"'::regclass) THEN
    ALTER TABLE "visibility_snapshots" ADD CONSTRAINT "visibility_snapshots_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "visibility_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_mentions_snapshot_id_fkey' AND conrelid = '"visibility_mentions"'::regclass) THEN
    ALTER TABLE "visibility_mentions" ADD CONSTRAINT "visibility_mentions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "visibility_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "visibility_queries" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3) DEFAULT NULL;
ALTER TABLE "visibility_queries" ADD COLUMN IF NOT EXISTS "last_checked_at" TIMESTAMP(3) DEFAULT NULL;
ALTER TABLE "visibility_queries" ADD COLUMN IF NOT EXISTS "attempt_failures" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "visibility_queries_active_next_attempt_at_last_checked_at_idx" ON "visibility_queries" ("active", "next_attempt_at", "last_checked_at");
ALTER TABLE "visibility_snapshots" ADD COLUMN IF NOT EXISTS "capture_config" JSONB DEFAULT NULL;
CREATE INDEX IF NOT EXISTS "visibility_queries_owner_id_created_at_id_idx" ON "visibility_queries" ("owner_id", "created_at" DESC, "id");
COMMIT;
