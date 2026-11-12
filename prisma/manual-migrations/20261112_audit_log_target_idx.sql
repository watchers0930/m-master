-- 20261112_audit_log_target_idx.sql — 감사 로그 대상별 조회 인덱스(추가 전용, 기존 데이터·컬럼 무변경)
-- 광고 제안 상세가 "이 제안의 마지막 적용 기록"(판매 금지 건너뜀)을 읽는다(lib/ads/proposals.ts lastSkippedKeywords).
-- 기존 (action, created_at) 인덱스로는 target_id를 좁히지 못해 다른 제안의 기록까지 훑는다(codex MED, 2026-11-12).
-- 운영 적용은 대장 승인 후, 잠금 없이 CONCURRENTLY로 별도 실행(트랜잭션 밖): 이 파일의 문장에 CONCURRENTLY를 붙인 형태.
CREATE INDEX IF NOT EXISTS "audit_log_target_type_target_id_action_created_at_idx" ON "audit_log"("target_type", "target_id", "action", "created_at");
