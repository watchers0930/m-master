// scripts/db/encrypt-channel-credentials.ts — channel_credentials 평문 비밀값(access/refresh token, meta.clientSecret·client_secret)을 v1 암호문으로 이전
// 사용: npx tsx scripts/db/encrypt-channel-credentials.ts --expect-kid=<16hex>           (기본 dry-run: 쓰기 없음, 개수만 출력)
//       npx tsx scripts/db/encrypt-channel-credentials.ts --expect-kid=<16hex> --apply   (행별 트랜잭션: 잠금 재조회 → 암호화 → 재복호화 확인 → 갱신, 멱등)
// 가드: CREDENTIAL_ENCRYPTION_SECRET 형식, 현재 키 kid === DB 앵커 kid === --expect-kid. 기존 v1 값이 하나라도 이 키로 안 열리면 쓰기 전에 중단.
// 출력: 행 수·채널명·필드별 개수·고정 오류 코드만(값·키·kid·오류 메시지 원문 미출력).
//
// ── 운영 이전 순서(이 순서 그대로, 건너뛰기 금지 — 로컬 .env.local과 운영이 같은 DB를 공유한다) ──────────────────
// (1) 비밀 생성: `openssl rand -base64 32` → kid 계산은 셸 기록이 남지 않게
//       read -s S && CREDENTIAL_ENCRYPTION_SECRET="$S" npx tsx scripts/crypto/key-id.ts
//     **같은 비밀**을 production / preview / development 와 로컬 .env.local에 printf로 넣는다(echo는 끝 개행 → 키 형식 오류):
//       printf '%s' "$S" | vercel env add CREDENTIAL_ENCRYPTION_SECRET <env>   (끝나면 unset S)
//     이전 코드는 이 env를 쓰지 않으므로 env를 먼저 넣어도 안전하다. (prisma/manual-migrations/20261110_credential_key_anchor.sql은 대장 승인 후 적용)
// (2) 이 커밋의 코드를 한 번 배포한다.
// (3) 플랫폼 오너로 운영 GET /api/admin/credential-key → kid 기록(이 시점 anchorKid=null, writable=false가 정상).
// (4) 로컬 `npx tsx scripts/crypto/key-id.ts`의 kid가 (3)과 같은지 확인.
// (5) `npx tsx scripts/crypto/set-anchor.ts --kid=<kid>`를 한 번 실행(DB 앵커 고정).
// (6) 엔드포인트가 anchorKid=<kid>, writable=true인지 확인(앱 앵커 캐시는 최대 60초).
// (7) 이 스크립트 dry-run(--expect-kid=<kid>) → 평문 개수 확인, 기존 v1 "현재 키로 안 열림" 0 확인 → 같은 인자에 --apply.
// (8) 운영 실화면 확인: /visitors(GA4 수치), 설정 › GA4 연결 상태, /channels(채널 연동).
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
    console.log('existing v1 fields — opens with current key:', report.sealed.readable, '| does not open:', report.sealed.unreadable);
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
