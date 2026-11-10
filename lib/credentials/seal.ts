// lib/credentials/seal.ts — 저장용 비밀값 봉인의 단일 진입점(앵커 판정 + 암호화)
// 로컬 .env.local과 운영이 같은 DB를 공유한다. 정본(앵커)이 아닌 키로 쓴 암호문 한 건이 운영 복호화를 깨뜨린다.
// 그래서 원시 encryptSecret은 이 파일만 가져다 쓰고(경계 테스트 lib/credentials/__tests__/boundaries.test.cjs가 강제),
// 모든 저장 경로(store·backfill·이후 광고 API 키 저장 등)는 sealForStorage를 거친다 — 호출자가 가드를 빠뜨릴 수 없다.
// - db 미지정: 앱 런타임 앵커 캐시(60초 TTL, anchor.ts) 사용 → 요청당 추가 조회 없음
// - db 지정: 캐시 없이 그 db(트랜잭션)로 앵커를 다시 읽는다(백필: 쓰는 트랜잭션 안에서 판정)
// 실패는 CredentialCryptoError(not_configured·key_mismatch 등, 값 없음).
import type { PrismaClient } from '@prisma/client';
import { encryptSecret } from '@/lib/crypto/credentials';
import { assertCredentialWritable } from './anchor';

export async function sealForStorage(plain: string, context: string, db?: Pick<PrismaClient, '$queryRaw'>): Promise<string> {
  await assertCredentialWritable(db);
  return encryptSecret(plain, context);
}
