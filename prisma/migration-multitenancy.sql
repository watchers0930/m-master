-- ================================================================
-- 멀티테넌시 마이그레이션 (안전한 순서)
-- ================================================================

-- 1) users 테이블 생성
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "stripe_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- 2) 관리자 계정 생성 (cuid 형태 고정 ID)
INSERT INTO "users" ("id", "email", "name", "password_hash", "plan", "updated_at")
VALUES ('cm_admin_001', 'admin@minteq.co.kr', 'Admin', '$2b$12$C71IalqaiBkfyS1iFn3iT.cs09gE68pBQyxKwagAm0TUm6AFCGUm2', 'pro', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 3) subscriptions 테이블 생성
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_sub_id" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_sub_id_key" ON "subscriptions"("stripe_sub_id");
CREATE INDEX IF NOT EXISTS "subscriptions_user_id_idx" ON "subscriptions"("user_id");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) owner_id 컬럼 추가 (nullable로 먼저)
ALTER TABLE "analytics_daily" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "cafe_targets" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "channel_credentials" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "cost_ledger" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "schedule_slots" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "topic_recommendations" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;

-- settings 테이블: id 타입 변경 + owner_id 추가
-- 기존 settings의 id를 text로 변환
DO $$
BEGIN
  -- settings.id가 integer라면 text로 변환
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'id' AND data_type = 'integer'
  ) THEN
    -- 기존 데이터의 id를 text로 변환하기 위해 임시 컬럼 사용
    ALTER TABLE "settings" ADD COLUMN "id_new" TEXT;
    UPDATE "settings" SET "id_new" = "id"::TEXT;
    ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";
    ALTER TABLE "settings" DROP COLUMN "id";
    ALTER TABLE "settings" RENAME COLUMN "id_new" TO "id";
    ALTER TABLE "settings" ALTER COLUMN "id" SET NOT NULL;
    ALTER TABLE "settings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::TEXT;
    ALTER TABLE "settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("id");
  END IF;
END
$$;

ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;

-- 5) 기존 데이터 → 관리자 ID로 백필
UPDATE "analytics_daily" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;
UPDATE "cafe_targets" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;
UPDATE "channel_credentials" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;
UPDATE "cost_ledger" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;
UPDATE "schedule_slots" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;
UPDATE "settings" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;
UPDATE "topic_recommendations" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" IS NULL;

-- 기존 ownerId 있는 테이블도 관리자로 업데이트 (default-owner → cm_admin_001)
UPDATE "contents" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" = 'default-owner' OR "owner_id" IS NULL;
UPDATE "ab_tests" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" = 'default-owner' OR "owner_id" IS NULL;
UPDATE "content_plans" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" = 'default-owner' OR "owner_id" IS NULL;
UPDATE "rag_documents" SET "owner_id" = 'cm_admin_001' WHERE "owner_id" = 'default-owner' OR "owner_id" IS NULL;

-- 6) NOT NULL 제약 추가
ALTER TABLE "analytics_daily" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "cafe_targets" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "channel_credentials" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "cost_ledger" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "schedule_slots" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "settings" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "topic_recommendations" ALTER COLUMN "owner_id" SET NOT NULL;

-- 7) 기존 인덱스 삭제 (충돌 방지)
DROP INDEX IF EXISTS "analytics_daily_date_channel_content_id_source_key";
DROP INDEX IF EXISTS "analytics_daily_date_channel_idx";
DROP INDEX IF EXISTS "channel_credentials_channel_key";
DROP INDEX IF EXISTS "cost_ledger_occurred_at_idx";
DROP INDEX IF EXISTS "topic_recommendations_month_channel_idx";
DROP INDEX IF EXISTS "topic_recommendations_week_start_channel_idx";

-- 8) 새 인덱스 생성 (ownerId 포함)
CREATE INDEX IF NOT EXISTS "analytics_daily_owner_id_date_channel_idx" ON "analytics_daily"("owner_id", "date", "channel");
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_owner_id_date_channel_content_id_source_key" ON "analytics_daily"("owner_id", "date", "channel", "content_id", "source");
CREATE UNIQUE INDEX IF NOT EXISTS "channel_credentials_owner_id_channel_key" ON "channel_credentials"("owner_id", "channel");
CREATE INDEX IF NOT EXISTS "cost_ledger_owner_id_occurred_at_idx" ON "cost_ledger"("owner_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "schedule_slots_owner_id_idx" ON "schedule_slots"("owner_id");
CREATE UNIQUE INDEX IF NOT EXISTS "settings_owner_id_key" ON "settings"("owner_id");
CREATE INDEX IF NOT EXISTS "topic_recommendations_owner_id_week_start_channel_idx" ON "topic_recommendations"("owner_id", "week_start", "channel");
CREATE INDEX IF NOT EXISTS "topic_recommendations_owner_id_month_channel_idx" ON "topic_recommendations"("owner_id", "month", "channel");

-- 9) FK 추가
ALTER TABLE "contents" ADD CONSTRAINT "contents_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_credentials" ADD CONSTRAINT "channel_credentials_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cafe_targets" ADD CONSTRAINT "cafe_targets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10) settings 기본 레코드 보장 (관리자용)
INSERT INTO "settings" ("id", "owner_id", "brand_guide", "prompt_templates", "budget_monthly", "alert_threshold", "notifications")
SELECT gen_random_uuid()::TEXT, 'cm_admin_001', '{}', '{}', 500000, 0.8, '{}'
WHERE NOT EXISTS (SELECT 1 FROM "settings" WHERE "owner_id" = 'cm_admin_001');
