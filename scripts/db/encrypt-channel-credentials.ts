// scripts/db/encrypt-channel-credentials.ts — channel_credentials 평문 비밀값(access/refresh token, meta.clientSecret·client_secret)을 v1 암호문으로 이전
// 사용: npx tsx scripts/db/encrypt-channel-credentials.ts           (기본 dry-run: 쓰기 없음, 채널·필드별 개수만 출력)
//       npx tsx scripts/db/encrypt-channel-credentials.ts --apply   (행별 트랜잭션: 잠금 재조회 → 암호화 → 재복호화 일치 확인 → 갱신, 멱등)
// ⚠️ CREDENTIAL_ENCRYPTION_SECRET은 운영 앱과 **같은 키**여야 한다(다르면 운영 전체 복호화 실패). 키가 없거나 형식이 틀리면 실행을 거부한다.
// 출력: 행 수·채널명·필드별 개수만. 값·키·키 식별자는 출력하지 않는다. 운영 적용 절차는 Task 13 Step 3-1.
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const apply = process.argv.includes('--apply');
  const { credentialKeyId, CredentialCryptoError } = await import('@/lib/crypto/credentials');
  try { credentialKeyId(); } catch (error) {
    console.error('거부: 암호화 키가 유효하지 않습니다', error instanceof CredentialCryptoError ? { reason: error.reason } : {});
    process.exit(1);
  }
  const { prisma } = await import('@/lib/prisma');
  const { backfillChannelCredentials } = await import('@/lib/credentials/backfill');
  try {
    const report = await backfillChannelCredentials(prisma, { apply });
    console.log(apply ? '[apply] 암호화 완료' : '[dry-run] 쓰기 없음 — 적용하려면 --apply');
    console.log('scanned rows:', report.scannedRows, '| updated rows:', report.updatedRows);
    const rows = Object.entries(report.legacy).flatMap(([channel, fields]) => Object.entries(fields).map(([field, count]) => ({ channel, field, count })));
    if (rows.length) console.table(rows); else console.log('평문 비밀 필드 없음');
  } catch (error) {
    // 메시지는 고정 코드만(값 미포함) — 실패한 행은 트랜잭션 롤백
    console.error('실패:', error instanceof CredentialCryptoError ? { reason: error.reason } : error instanceof Error ? error.message : 'unknown');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
