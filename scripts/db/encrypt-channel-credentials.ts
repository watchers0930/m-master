// scripts/db/encrypt-channel-credentials.ts — channel_credentials 평문 비밀값(access/refresh token, meta.clientSecret·client_secret)을 v1 암호문으로 이전
// 사용: npx tsx scripts/db/encrypt-channel-credentials.ts --expect-kid=<16hex>           (기본 dry-run: 쓰기 없음, 개수만 출력)
//       npx tsx scripts/db/encrypt-channel-credentials.ts --expect-kid=<16hex> --apply   (행별 트랜잭션: 잠금 재조회 → 암호화 → 재복호화 확인 → 갱신, 멱등)
// 가드: CREDENTIAL_ENCRYPTION_SECRET 형식, 현재 키 kid === DB 앵커 kid === --expect-kid. 기존 v1 값이 하나라도 이 키로 안 열리면 쓰기 전에 중단.
// 출력: 행 수·채널명·필드별 개수·고정 오류 코드만(값·키·kid·오류 메시지 원문 미출력).
//
// ── 운영 이전 순서(이 순서 그대로, 건너뛰기 금지 — 로컬 .env.local과 운영이 같은 DB를 공유한다) ──────────────────
// (0) 대장 승인 → prisma/manual-migrations/20261110_credential_key_anchor.sql 을 공유 DB에 적용(CREATE TABLE IF NOT EXISTS, 추가 전용)
//     → 테이블 존재 확인: SELECT to_regclass('public.credential_key_anchor');  (NULL이 아니어야 함, 행은 아직 0개가 정상)
//     이 코드를 배포하기 전에 끝낸다. 테이블이 없으면 배포 후 모든 자격증명 저장·삭제가 거부된다(화면의 복구 판정은 false로 안전 처리).
// (1) 비밀 생성 — 값을 화면·셸 기록에 남기지 않고 바로 변수에 담는다(출력 금지):
//       S=$(openssl rand -base64 32)
//       CREDENTIAL_ENCRYPTION_SECRET="$S" npx tsx scripts/crypto/key-id.ts      → kid(16 hex)만 출력, 기록
//     **같은 비밀**을 production / preview / development 와 로컬 .env.local에 printf로 넣는다(echo는 끝 개행 → 키 형식 오류):
//       printf '%s' "$S" | vercel env add CREDENTIAL_ENCRYPTION_SECRET <env>      (3개 환경 각각)
//       .env.local(기존 줄을 먼저 지운 뒤 추가 — 중복 줄이면 앞줄이 이긴다):
//         sed -i '' '/^CREDENTIAL_ENCRYPTION_SECRET=/d' .env.local   (macOS BSD sed)
//         printf 'CREDENTIAL_ENCRYPTION_SECRET=%s\n' "$S" >> .env.local
//       unset S
//     이전 코드는 이 env를 쓰지 않으므로 env를 먼저 넣어도 안전하다.
// (2) 이 커밋의 코드를 한 번 배포한다.
// (3) 플랫폼 오너로 운영 GET /api/admin/credential-key → kid 기록(이 시점 anchorKid=null, writable=false가 정상).
//     500(internal_error)이면 (0) 테이블 미적용이다 — 멈추고 (0)부터.
// (4) 로컬 `npx tsx scripts/crypto/key-id.ts`의 kid가 (1)·(3)과 같은지 확인.
// (5) `npx tsx scripts/crypto/set-anchor.ts --kid=<kid>`를 한 번 실행(DB 앵커 고정).
// (6) 엔드포인트가 anchorKid=<kid>, writable=true인지 확인(앱 앵커 캐시는 최대 60초).
// (7) 이 스크립트 dry-run(--expect-kid=<kid>) → 평문 개수 확인, 기존 v1 "현재 키로 안 열림" 0 확인 → 같은 인자에 --apply.
// (8) 운영 실화면 확인: /visitors(GA4 수치), 설정 › GA4 연결 상태, /channels(채널 연동).
// 백필 이후 금지: 이 커밋보다 오래된 배포로 rollback/instant-rollback(암호문을 못 읽음), 오래된 preview 배포 방치(삭제할 것),
//   오래된 브랜치에서 공유 DB로 로컬 dev 실행. (계획서의 Task 13 Step 3-1이 이 절차를 따른다.)
//
// ── 앵커를 잘못 고정했을 때 복구(선점 등: 운영 런타임 kid ≠ anchorKid) ──────────────────────────────────
// (a) 플랫폼 오너로 운영 GET /api/admin/credential-key → 운영 kid와 anchorKid가 다르고 writable=false임을 확인(kid는 비밀이 아님).
// (b) 잘못된 키 환경(그 키를 쓰는 로컬 dev·preview·스크립트 등)의 프로세스를 모두 중지하고, 앵커 캐시 TTL(60초)을 넘겨
//     60초 이상 기다린다 — 그 프로세스가 캐시해 둔 잘못된 앵커로 계속 쓰는 것을 막기 위함.
//     그 다음 **대장 승인 후에만** 공유 DB에서: DELETE FROM credential_key_anchor WHERE id='default';
// (c) (a)에서 확인한 운영 kid로 `npx tsx scripts/crypto/set-anchor.ts --kid=<운영 kid>` 재실행(로컬 키도 그 kid여야 함) → (6) 재확인.
//     이어서 이 스크립트 dry-run(--expect-kid=<운영 kid>)을 다시 돌려 "does not open" == 0 을 확인한다(0이 아니면 (d) 후 반복).
// (d) 잘못된 앵커 동안 그 (운영이 아닌) 키로 쓴 행은 운영 키로 열리지 않는다 → 해당 채널은 화면에서 연결 해제 후 다시 입력(재연결)한다.
//     dry-run의 "does not open" 이 0이 될 때까지 반복한다.
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
