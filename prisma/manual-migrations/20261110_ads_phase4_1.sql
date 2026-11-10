-- 20261110_ads_phase4_1.sql — 네이버 검색광고 Phase 4-1 데이터 모델 (추가 전용: 새 ad_* 테이블·인덱스·FK만, 기존 테이블 무변경)
-- 생성: prisma migrate diff --from-schema-datamodel <8b70c21 schema> --to-schema-datamodel prisma/schema.prisma --script 결과를 재실행 안전하게 감쌈.
-- FK는 전부 ON DELETE RESTRICT: 계정 삭제는 status=disabled 소프트 삭제이며, 하위 미러·성과·로그·알림이 조용히 연쇄 삭제되지 않는다.
-- 계정 연결 해제 = api_key_enc·secret_key_enc·key_last4를 NULL로 지우고 status=disabled(행·성과는 보존).
-- 미러 4개(ad_campaigns·ad_groups·ad_keywords·ad_creatives)의 lock_version·locked_at = 켜기·끄기 CAS(Task 9, 동기화 쓰기는 건드리지 않음).
-- 적용은 대장 승인 후(Task 13). db push 금지.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_accounts" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "naver_customer_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "api_key_enc" TEXT,
    "secret_key_enc" TEXT,
    "key_last4" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "disconnect_from_status" TEXT,
    "daily_cap_krw" INTEGER NOT NULL DEFAULT 100000,
    "shared_budget_krw" INTEGER NOT NULL DEFAULT 100000,
    "max_bid_krw" INTEGER NOT NULL DEFAULT 2000,
    "shared_budget_id" TEXT,
    "business_channel_id" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_proposals" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_adgroup_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "payload" JSONB NOT NULL,
    "lint_result" JSONB,
    "source_keywords" JSONB NOT NULL DEFAULT '[]',
    "cost_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "fail_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_campaigns" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "naver_id" TEXT NOT NULL,
    "parent_naver_id" TEXT,
    "name" TEXT NOT NULL,
    "inspect_status" TEXT,
    "user_lock" BOOLEAN NOT NULL DEFAULT true,
    "locked_by" TEXT,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_groups" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "naver_id" TEXT NOT NULL,
    "parent_naver_id" TEXT,
    "name" TEXT NOT NULL,
    "bid_amt" INTEGER,
    "inspect_status" TEXT,
    "user_lock" BOOLEAN NOT NULL DEFAULT true,
    "locked_by" TEXT,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_keywords" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "naver_id" TEXT NOT NULL,
    "parent_naver_id" TEXT,
    "name" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "bid_amt" INTEGER,
    "inspect_status" TEXT,
    "user_lock" BOOLEAN NOT NULL DEFAULT true,
    "locked_by" TEXT,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_creatives" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "naver_id" TEXT NOT NULL,
    "parent_naver_id" TEXT,
    "name" TEXT NOT NULL,
    "slot" TEXT,
    "headline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inspect_status" TEXT,
    "user_lock" BOOLEAN NOT NULL DEFAULT true,
    "locked_by" TEXT,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_performance_daily" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "naver_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "imp_cnt" INTEGER NOT NULL DEFAULT 0,
    "clk_cnt" INTEGER NOT NULL DEFAULT 0,
    "cost_krw" INTEGER NOT NULL DEFAULT 0,
    "ccnt" INTEGER NOT NULL DEFAULT 0,
    "avg_rnk" DOUBLE PRECISION,

    CONSTRAINT "ad_performance_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_operation_logs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "step" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "naver_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_alerts" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "kst_date" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "claimed_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_accounts_owner_id_naver_customer_id_key" ON "ad_accounts"("owner_id", "naver_customer_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_proposals_owner_id_status_created_at_idx" ON "ad_proposals"("owner_id", "status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_proposals_ad_account_id_idx" ON "ad_proposals"("ad_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_campaigns_owner_id_ad_account_id_idx" ON "ad_campaigns"("owner_id", "ad_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_campaigns_ad_account_id_locked_by_idx" ON "ad_campaigns"("ad_account_id", "locked_by");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_campaigns_ad_account_id_naver_id_key" ON "ad_campaigns"("ad_account_id", "naver_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_groups_owner_id_ad_account_id_idx" ON "ad_groups"("owner_id", "ad_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_groups_ad_account_id_locked_by_idx" ON "ad_groups"("ad_account_id", "locked_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_groups_ad_account_id_parent_naver_id_idx" ON "ad_groups"("ad_account_id", "parent_naver_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_groups_ad_account_id_naver_id_key" ON "ad_groups"("ad_account_id", "naver_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_keywords_owner_id_ad_account_id_idx" ON "ad_keywords"("owner_id", "ad_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_keywords_ad_account_id_locked_by_idx" ON "ad_keywords"("ad_account_id", "locked_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_keywords_ad_account_id_parent_naver_id_idx" ON "ad_keywords"("ad_account_id", "parent_naver_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_keywords_ad_account_id_naver_id_key" ON "ad_keywords"("ad_account_id", "naver_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_creatives_owner_id_ad_account_id_idx" ON "ad_creatives"("owner_id", "ad_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_creatives_ad_account_id_locked_by_idx" ON "ad_creatives"("ad_account_id", "locked_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_creatives_ad_account_id_parent_naver_id_idx" ON "ad_creatives"("ad_account_id", "parent_naver_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_creatives_ad_account_id_naver_id_key" ON "ad_creatives"("ad_account_id", "naver_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_performance_daily_owner_id_ad_account_id_date_idx" ON "ad_performance_daily"("owner_id", "ad_account_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_performance_daily_ad_account_id_naver_id_date_key" ON "ad_performance_daily"("ad_account_id", "naver_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_operation_logs_owner_id_ad_account_id_created_at_idx" ON "ad_operation_logs"("owner_id", "ad_account_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_operation_logs_proposal_id_idx" ON "ad_operation_logs"("proposal_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ad_alerts_owner_id_kst_date_idx" ON "ad_alerts"("owner_id", "kst_date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_alerts_ad_account_id_type_kst_date_dedupe_key_key" ON "ad_alerts"("ad_account_id", "type", "kst_date", "dedupe_key");

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_accounts_owner_id_fkey' AND conrelid = '"ad_accounts"'::regclass) THEN
  ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_proposals_owner_id_fkey' AND conrelid = '"ad_proposals"'::regclass) THEN
  ALTER TABLE "ad_proposals" ADD CONSTRAINT "ad_proposals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_proposals_ad_account_id_fkey' AND conrelid = '"ad_proposals"'::regclass) THEN
  ALTER TABLE "ad_proposals" ADD CONSTRAINT "ad_proposals_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_campaigns_owner_id_fkey' AND conrelid = '"ad_campaigns"'::regclass) THEN
  ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_campaigns_ad_account_id_fkey' AND conrelid = '"ad_campaigns"'::regclass) THEN
  ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_campaigns_proposal_id_fkey' AND conrelid = '"ad_campaigns"'::regclass) THEN
  ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ad_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_groups_owner_id_fkey' AND conrelid = '"ad_groups"'::regclass) THEN
  ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_groups_ad_account_id_fkey' AND conrelid = '"ad_groups"'::regclass) THEN
  ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_groups_proposal_id_fkey' AND conrelid = '"ad_groups"'::regclass) THEN
  ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ad_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_keywords_owner_id_fkey' AND conrelid = '"ad_keywords"'::regclass) THEN
  ALTER TABLE "ad_keywords" ADD CONSTRAINT "ad_keywords_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_keywords_ad_account_id_fkey' AND conrelid = '"ad_keywords"'::regclass) THEN
  ALTER TABLE "ad_keywords" ADD CONSTRAINT "ad_keywords_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_keywords_proposal_id_fkey' AND conrelid = '"ad_keywords"'::regclass) THEN
  ALTER TABLE "ad_keywords" ADD CONSTRAINT "ad_keywords_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ad_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_creatives_owner_id_fkey' AND conrelid = '"ad_creatives"'::regclass) THEN
  ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_creatives_ad_account_id_fkey' AND conrelid = '"ad_creatives"'::regclass) THEN
  ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_creatives_proposal_id_fkey' AND conrelid = '"ad_creatives"'::regclass) THEN
  ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ad_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_performance_daily_owner_id_fkey' AND conrelid = '"ad_performance_daily"'::regclass) THEN
  ALTER TABLE "ad_performance_daily" ADD CONSTRAINT "ad_performance_daily_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_performance_daily_ad_account_id_fkey' AND conrelid = '"ad_performance_daily"'::regclass) THEN
  ALTER TABLE "ad_performance_daily" ADD CONSTRAINT "ad_performance_daily_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_operation_logs_owner_id_fkey' AND conrelid = '"ad_operation_logs"'::regclass) THEN
  ALTER TABLE "ad_operation_logs" ADD CONSTRAINT "ad_operation_logs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_operation_logs_ad_account_id_fkey' AND conrelid = '"ad_operation_logs"'::regclass) THEN
  ALTER TABLE "ad_operation_logs" ADD CONSTRAINT "ad_operation_logs_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_operation_logs_proposal_id_fkey' AND conrelid = '"ad_operation_logs"'::regclass) THEN
  ALTER TABLE "ad_operation_logs" ADD CONSTRAINT "ad_operation_logs_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ad_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_alerts_owner_id_fkey' AND conrelid = '"ad_alerts"'::regclass) THEN
  ALTER TABLE "ad_alerts" ADD CONSTRAINT "ad_alerts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_alerts_ad_account_id_fkey' AND conrelid = '"ad_alerts"'::regclass) THEN
  ALTER TABLE "ad_alerts" ADD CONSTRAINT "ad_alerts_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

COMMIT;
