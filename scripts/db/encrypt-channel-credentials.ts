// scripts/db/encrypt-channel-credentials.ts — channel_credentials 평문 비밀값(access/refresh token, meta.clientSecret·client_secret)을 v1 암호문으로 이전
// 사용: npx tsx scripts/db/encrypt-channel-credentials.ts --expect-kid=<16hex>           (기본 dry-run: 쓰기 없음, 개수만 출력)
//       npx tsx scripts/db/encrypt-channel-credentials.ts --expect-kid=<16hex> --apply   (행별 트랜잭션: 잠금 재조회 → 암호화 → 재복호화 확인 → 갱신, 멱등)
// 가드: CREDENTIAL_ENCRYPTION_SECRET 형식, CREDENTIAL_KEY_ID === 현재 키 kid === --expect-kid. 기존 v1 값이 하나라도 이 키로 안 열리면 쓰기 전에 중단.
// 출력: 행 수·채널명·필드별 개수·고정 오류 코드만(값·키·kid·오류 메시지 원문 미출력).
//
// ── 운영 이전 순서(이 순서 그대로, 건너뛰기 금지 — 로컬 .env.local이 운영 DB를 공유한다) ──────────────────
// (1) 이 커밋의 코드를 배포한다(이중 읽기 코드가 먼저 운영에 있어야 평문·암호문을 모두 읽는다).
// (2) CREDENTIAL_ENCRYPTION_SECRET + CREDENTIAL_KEY_ID를 production / preview / development 와 로컬 .env.local에 **같은 값**으로 넣는다.
// (3) 재배포한다(Vercel env 변경은 재배포해야 런타임에 반영된다).
// (4) 운영 kid를 읽기 전용으로 확인해 CREDENTIAL_KEY_ID와 같은지 본다(값 노출 없이 kid만 비교).
// (5) dry-run → 개수·unreadable 0 확인 → --apply (둘 다 --expect-kid=<(4)에서 확인한 운영 kid>).
// (6) 운영 실화면에서 /visitors(GA4 수치)와 설정 › GA4 연결 상태, 채널 연동 화면을 확인한다.
// 백필 이후 금지: 이 커밋보다 오래된 배포로 rollback/instant-rollback(암호문을 못 읽음), 오래된 preview 배포 방치(삭제할 것),
//   오래된 브랜치에서 공유 DB로 로컬 dev 실행. (계획서의 Task 13 Step 3-1이 이 절차를 따른다.)
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const apply = process.argv.includes('--apply');
  const expectKid = process.argv.find(a => a.startsWith('--expect-kid='))?.slice('--expect-kid='.length) ?? '';
  const { CredentialCryptoError } = await import('@/lib/crypto/credentials');
  const { backfillChannelCredentials, BackfillAbort } = await import('@/lib/credentials/backfill');
  const { prisma } = await import('@/lib/prisma');
  try {
    const report = await backfillChannelCredentials(prisma, { apply, expectKid });
    console.log(apply ? '[apply] 암호화 완료' : '[dry-run] 쓰기 없음 — 적용하려면 --apply');
    console.log('scanned rows:', report.scannedRows, '| updated rows:', report.updatedRows);
    const rows = Object.entries(report.legacy).flatMap(([channel, fields]) => Object.entries(fields).map(([field, count]) => ({ channel, field, count })));
    if (rows.length) console.table(rows); else console.log('평문 비밀 필드 없음');
    if (Object.keys(report.unreadable).length) {
      console.error('경고: 현재 키로 열리지 않는 기존 암호문 — --apply는 거부됩니다', report.unreadable);
      process.exitCode = 1;
    }
  } catch (error) {
    // 고정 코드만 출력한다(error.message·스택 미출력)
    if (error instanceof BackfillAbort) console.error('중단:', error.code, Object.keys(error.unreadable).length ? error.unreadable : '');
    else if (error instanceof CredentialCryptoError) console.error('중단: crypto', error.reason);
    else console.error('중단: unexpected_error');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
