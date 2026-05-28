-- 주간 토픽 자동생성 전환: 월간 → 주간
-- topic_recommendations: month nullable + week_start 추가
-- content_plans: monthKey nullable + weekKey 추가

-- 1) topic_recommendations: month를 nullable로 변경, week_start 컬럼 추가
ALTER TABLE "topic_recommendations" ALTER COLUMN "month" DROP NOT NULL;
ALTER TABLE "topic_recommendations" ADD COLUMN "week_start" TEXT;
CREATE INDEX "topic_recommendations_week_start_channel_idx" ON "topic_recommendations"("week_start", "channel");

-- 2) content_plans: month_key를 nullable로 변경, week_key 컬럼 추가
ALTER TABLE "content_plans" ALTER COLUMN "month_key" DROP NOT NULL;
ALTER TABLE "content_plans" ADD COLUMN "week_key" TEXT;

-- unique 제약 변경: [ownerId, weekKey] 추가
CREATE UNIQUE INDEX "content_plans_owner_id_week_key_key" ON "content_plans"("owner_id", "week_key");
