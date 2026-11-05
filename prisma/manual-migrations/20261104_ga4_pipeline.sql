-- AlterTable
ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS "parent_content_id" TEXT,
ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT,
ADD COLUMN IF NOT EXISTS "strategy_context" JSONB;

-- 1회성 검토 백필 — 실행 여부는 원장(manual_migration_log)으로 판정(컬럼 존재 여부 X):
-- 구버전 SQL(백필 없음)이 이미 적용된 DB에서도 정확히 1회 실행되고, 재실행 시 이후 데이터를 덮어쓰지 않는다.
-- 기본값 approved 를 그대로 두면 과거 미발행 draft 가 승인 없이 블로그 워커 대상이 된다(날짜 조건 없이 approved draft 선택).
--  · 과거 자동 계획(content_plans.auto_generate)이 만든 글 → origin=auto
--  · 사람이 명시 승인하지 않은(reviewed_at NULL) 미발행 draft → pending_review
--    단 사용자가 직접 예약(scheduled 슬롯)한 수동 글은 approved 유지(회귀 없음)
CREATE TABLE IF NOT EXISTS "manual_migration_log" ("name" TEXT PRIMARY KEY, "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "manual_migration_log" WHERE "name" = '20261104_review_backfill') THEN
    UPDATE "contents" c SET "origin" = 'auto'
      WHERE c."origin" = 'manual' AND c."id" IN (SELECT i."content_job_id" FROM "content_plan_items" i JOIN "content_plans" p ON p."id" = i."content_plan_id"
                       WHERE p."auto_generate" AND i."content_job_id" IS NOT NULL);
    UPDATE "contents" c SET "review_status" = 'pending_review'
      WHERE c."status" = 'draft' AND c."review_status" = 'approved' AND c."reviewed_at" IS NULL
        AND (c."origin" = 'auto' OR NOT EXISTS (
          SELECT 1 FROM "schedule_slots" s WHERE s."content_id" = c."id" AND s."status" = 'scheduled'));
    INSERT INTO "manual_migration_log" ("name") VALUES ('20261104_review_backfill');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "automation_domain_id" TEXT;

-- AlterTable
ALTER TABLE "content_plan_items" ADD COLUMN IF NOT EXISTS "strategy_context" JSONB,
ADD COLUMN IF NOT EXISTS "topic_recommendation_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ga4_bindings" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "allowed_sources" TEXT[] DEFAULT ARRAY['service_account']::TEXT[],
    "conversion_events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_checked_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ga4_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "publish_claims" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination_key" TEXT NOT NULL DEFAULT 'default',
    "content_version" TIMESTAMP(3),
    "token" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "lease_until" TIMESTAMP(3) NOT NULL,
    "external_id" TEXT,
    "external_url" TEXT,
    "error_code" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "publish_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "lease_until" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "result_ref" JSONB,
    "error_code" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ga4_bindings_domain_id_key" ON "ga4_bindings"("domain_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ga4_bindings_owner_id_status_idx" ON "ga4_bindings"("owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "publish_claims_token_key" ON "publish_claims"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "publish_claims_owner_id_channel_finished_at_idx" ON "publish_claims"("owner_id", "channel", "finished_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "publish_claims_target_type_target_id_idx" ON "publish_claims"("target_type", "target_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "publish_claims_status_lease_until_idx" ON "publish_claims"("status", "lease_until");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pipeline_runs_kind_period_key_status_idx" ON "pipeline_runs"("kind", "period_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_runs_kind_owner_id_scope_key_period_key_key" ON "pipeline_runs"("kind", "owner_id", "scope_key", "period_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contents_owner_id_review_status_created_at_idx" ON "contents"("owner_id", "review_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contents_parent_content_id_idx" ON "contents"("parent_content_id");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "ga4_bindings" ADD CONSTRAINT "ga4_bindings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "ga4_bindings" ADD CONSTRAINT "ga4_bindings_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE UNIQUE INDEX IF NOT EXISTS publish_claims_active_uq ON publish_claims (target_type,target_id,channel,destination_key) WHERE status IN ('claimed','sent','unknown');
DO $$ BEGIN
  ALTER TABLE contents ADD CONSTRAINT contents_origin_check CHECK (origin IN ('manual','auto')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE contents VALIDATE CONSTRAINT contents_origin_check;
DO $$ BEGIN
  ALTER TABLE contents ADD CONSTRAINT contents_review_status_check CHECK (review_status IN ('pending_review','approved','rejected')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE contents VALIDATE CONSTRAINT contents_review_status_check;

-- Optional web stream scopes realtime queries; unconfigured streams remain unavailable.
ALTER TABLE ga4_bindings ADD COLUMN IF NOT EXISTS stream_id TEXT;
