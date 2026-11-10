// scripts/crypto/set-anchor.ts — 테스트·별도 개발 DB 전용 자격증명 키 앵커(credential_key_anchor) 1회 생성
// ⚠️ 운영 앵커는 이 스크립트가 아니라 운영 화면의 POST /api/admin/credential-key로만 만든다(운영 런타임이 자기 kid로 직접 쓴다).
//    그래서 이 스크립트는 운영 DB에 쓰지 못한다: --non-production 플래그가 없거나, Prisma가 읽는 DB url 중 하나라도
//    허용목록 밖이거나(로컬 localhost·127.0.0.1·::1·유닉스 소켓, 또는 env SET_ANCHOR_ALLOWED_HOSTS에 적힌 호스트·엔드포인트만 —
//    lib/credentials/anchor-target.ts), 운영 엔드포인트이거나, VERCEL_ENV=production이면 Prisma를 import하기 전에 거부한다(exit 1).
//    로컬 .env.local은 운영과 같은 DB를 공유하므로 로컬에서도 기본은 거부다.
// 사용(별도 DB에서만): npx tsx scripts/crypto/set-anchor.ts --kid=<16hex> --non-production
//   - 앵커 없음 → 생성("created"), 같은 kid로 이미 있음 → no-op("unchanged"), 다른 kid로 있음 → 거부(exit 1, anchor_conflict)
//   - 오타 방지: 이 프로세스의 CREDENTIAL_ENCRYPTION_SECRET(env 또는 .env.local) kid도 --kid와 같아야 한다(local_key_mismatch)
//   - 출력은 결과·고정 오류 코드만. 비밀값·DB url·오류 원문은 출력하지 않는다.
// 운영 절차 전체는 scripts/db/encrypt-channel-credentials.ts 헤더와 Task 13 런북을 따른다.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { setAnchorTargetRefusal } from '@/lib/credentials/anchor-target';
(async () => {
  const refusal = setAnchorTargetRefusal(process.argv, process.env);
  if (refusal) {
    console.error(`거부: ${refusal} — 운영 앵커는 운영 화면의 POST /api/admin/credential-key로만 만든다`);
    process.exitCode = 1;
    return;
  }
  const kid = process.argv.find(a => a.startsWith('--kid='))?.slice('--kid='.length) ?? '';
  const { CredentialCryptoError } = await import('@/lib/crypto/credentials');
  const { setAnchor, AnchorError } = await import('@/lib/credentials/anchor');
  const { prisma } = await import('@/lib/prisma');
  try {
    console.log(await setAnchor(prisma, kid));
  } catch (error) {
    if (error instanceof AnchorError) console.error('거부:', error.code);
    else if (error instanceof CredentialCryptoError) console.error('거부: crypto', error.reason);
    else console.error('거부: unexpected_error');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
