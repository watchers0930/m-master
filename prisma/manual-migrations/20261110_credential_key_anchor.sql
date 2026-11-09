-- 20261110_credential_key_anchor.sql — 정본 자격증명 키 식별자(kid) 앵커 (추가 전용, 기존 테이블 무변경)
-- 로컬 .env.local과 운영이 같은 DB를 공유하므로, "어느 키로 써도 되는가"를 env가 아니라 DB 한 행으로 고정한다.
-- 앱의 모든 자격증명 쓰기는 런타임 키 kid == 이 행의 kid 일 때만 허용된다(lib/credentials/anchor.ts).
-- 행 생성은 scripts/crypto/set-anchor.ts 로만 한다(이 파일은 테이블만 만든다). 적용은 대장 승인 후.
CREATE TABLE IF NOT EXISTS "credential_key_anchor" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "kid" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "credential_key_anchor_pkey" PRIMARY KEY ("id")
);
