// scripts/crypto/set-anchor.ts — 정본 자격증명 키 앵커(credential_key_anchor) 1회 생성(공유 DB에 다른 키로 쓰는 것을 막는 기준)
// 사용: npx tsx scripts/crypto/set-anchor.ts --kid=<16hex>
//   - 앵커 없음 → 생성("created"), 같은 kid로 이미 있음 → no-op("unchanged"), 다른 kid로 있음 → 거부(exit 1, anchor_conflict)
//   - 오타 방지: 이 프로세스의 CREDENTIAL_ENCRYPTION_SECRET(env 또는 .env.local) kid도 --kid와 같아야 한다(local_key_mismatch)
//   - 출력은 결과·고정 오류 코드만. 비밀값·오류 원문은 출력하지 않는다. ⚠️ 운영 DB에 쓰는 스크립트 — 런북 순서대로만 실행.
// 런북(전체 순서는 scripts/db/encrypt-channel-credentials.ts 헤더):
//   (0) 대장 승인 → 앵커 테이블 마이그레이션 적용·존재 확인 → (1) 비밀 생성·kid 계산·env 입력 → (2) 이 코드 1회 배포 → (3) 운영 GET /api/admin/credential-key 로 kid 확인(anchorKid null, writable false)
//   → (4) 로컬 key-id.ts kid가 같은지 확인 → (5) 이 스크립트 --kid=<kid> 1회 → (6) 엔드포인트 writable:true 확인
//   잘못 고정했을 때(선점 등)의 복구 절차(대장 승인 필요한 수동 SQL)는 같은 헤더의 '앵커를 잘못 고정했을 때 복구' 참조
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
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
