// GET /api/admin/credential-key — 운영 런타임 키 식별자(kid)와 DB 앵커 kid 확인(읽기 전용, 운영자가 브라우저로 직접 연다)
// 운영 이전 시 "운영 앱이 실제로 쓰는 키 = 정본(앵커) 키 = 로컬 키"를 값 노출 없이 대조하는 수단(scripts/crypto/set-anchor.ts 런북).
// - 플랫폼 오너만 200 { kid, anchorKid, writable, reason? }. 미로그인·다른 사용자는 존재를 숨기기 위해 404.
// - 의도적으로 어떤 클라이언트 컴포넌트에서도 호출하지 않는다: 플랫폼 오너가 키 앵커 런북 중 브라우저로 직접 연다. 미사용 엔드포인트 점검의 문서화된 예외(대장 결정 2026-11-10).
// - GET 외 메서드(OPTIONS 포함)는 누구에게나 404(405·Allow 헤더로 존재가 드러나지 않게).
// - 내부 오류(DB 등)는 고정 본문 500, 서버 로그엔 코드만. 응답·로그에 비밀값 없음(kid는 비밀이 아님).
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isPlatformOwner } from '@/lib/channel-credentials';
import { credentialKeyStatus } from '@/lib/credentials/anchor';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const hidden = () => NextResponse.json({ error: { code: 'not_found', message: '대상을 찾을 수 없습니다.' } }, { status: 404, headers: NO_STORE });

export async function GET() {
  try {
    let userId: string;
    try { userId = (await requireSession()).user.id; }
    catch (error) {
      if (error instanceof Error && error.message === 'Unauthorized') return hidden();
      throw error;
    }
    if (!(await isPlatformOwner(userId))) return hidden();
    return NextResponse.json(await credentialKeyStatus(), { headers: NO_STORE });
  } catch {
    console.error('[credentials] key status failed', { code: 'internal_error' });
    return NextResponse.json({ error: { code: 'internal_error', message: '처리하지 못했습니다.' } }, { status: 500, headers: NO_STORE });
  }
}

export const POST = hidden;
export const PUT = hidden;
export const PATCH = hidden;
export const DELETE = hidden;
// OPTIONS를 직접 export하지 않으면 Next가 Allow 헤더(구현 메서드 목록)로 자동 응답해 경로 존재가 드러난다
export const OPTIONS = hidden;
