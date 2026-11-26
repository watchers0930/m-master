-- 20261126_ad_extensions.sql — 확장소재 미러 ad_extensions(3.6단계, 추가 전용: 새 테이블·인덱스·FK만, 기존 테이블 무변경)
-- 생성: prisma migrate diff --from-schema-datamodel <ddb2b4e schema> --to-schema-datamodel prisma/schema.prisma --script 결과를 재실행 안전하게 감쌈.
-- FK는 ON DELETE RESTRICT(다른 ad_* 미러와 같다 — 계정 삭제는 소프트 삭제).
-- (ad_account_id, parent_naver_id, type) 유일 = MINTEQ가 그룹마다 유형별로 1개만 만든다(생성 점유, lib/ads/extensions/apply.ts).
-- 적용은 대장 승인 후, 백업 뒤. db push 금지.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "ad_extensions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "parent_naver_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "naver_id" TEXT,
    "inspect_status" TEXT,
    "user_lock" BOOLEAN,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_extensions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ad_extensions_owner_id_ad_account_id_idx" ON "ad_extensions"("owner_id", "ad_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ad_extensions_ad_account_id_parent_naver_id_type_key" ON "ad_extensions"("ad_account_id", "parent_naver_id", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "ad_extensions_ad_account_id_naver_id_key" ON "ad_extensions"("ad_account_id", "naver_id");

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_extensions_owner_id_fkey' AND conrelid = '"ad_extensions"'::regclass) THEN
  ALTER TABLE "ad_extensions" ADD CONSTRAINT "ad_extensions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_extensions_ad_account_id_fkey' AND conrelid = '"ad_extensions"'::regclass) THEN
  ALTER TABLE "ad_extensions" ADD CONSTRAINT "ad_extensions_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

COMMIT;
