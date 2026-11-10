// scripts/crypto/key-id.ts — CREDENTIAL_ENCRYPTION_SECRET의 키 식별자(kid, 16 hex)만 출력한다(비밀값은 절대 출력하지 않음)
// 사용: npx tsx scripts/crypto/key-id.ts
//   env(우선) 또는 .env.local의 CREDENTIAL_ENCRYPTION_SECRET을 읽는다. DB 접속 없음.
//   성공: kid 한 줄(stdout). 실패: 고정 코드 한 줄(stderr, 예: not_configured) + exit 1.
//   이 값을 운영 GET /api/admin/credential-key 의 kid와 대조한다. 운영 앵커는 운영 화면의 POST /api/admin/credential-key로만 만든다.
//   새 비밀의 kid 계산(값은 출력하지 않고 변수에만): S=$(openssl rand -base64 32); CREDENTIAL_ENCRYPTION_SECRET="$S" npx tsx scripts/crypto/key-id.ts
//   env 입력까지 끝나면 unset S (전체 순서는 scripts/db/encrypt-channel-credentials.ts 헤더)
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const { credentialKeyId, CredentialCryptoError } = await import('@/lib/crypto/credentials');
  try { console.log(credentialKeyId()); }
  catch (error) {
    console.error(error instanceof CredentialCryptoError ? error.reason : 'unexpected_error');
    process.exitCode = 1;
  }
})();
