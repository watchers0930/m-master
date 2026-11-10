// /api/admin/credential-key — 자격증명 키 앵커(credential_key_anchor) 확인(GET)과 운영 앵커 생성(POST). 운영자가 브라우저로 직접 연다.
// GET: 운영 런타임 kid·DB 앵커 kid·쓰기 가능 여부(읽기 전용, 값 노출 없이 "운영 키 = 앵커 = 로컬 키" 대조).
// POST: 운영 앵커를 **운영 런타임이 자기 kid(credentialKeyId())로 직접** 쓴다 — 로컬 스크립트가 로컬 키로 앵커를 고정해
//   운영 앱이 전 자격증명을 못 여는 사고(2026-09 PII 키 사고 유형)를 구조적으로 막는다. scripts/crypto/set-anchor.ts는 운영 DB를 거부한다.
//   - VERCEL_ENV === 'production'에서만(그 밖은 오너에게 403 not_production), 같은 출처 증명 필수(기존 requireOrigin 규칙, 403 forbidden_origin)
//   - 앵커 없음 → 생성 200 {result:'created'}, 같은 kid → 멱등 200 {result:'unchanged'}, 다른 kid → 409 anchor_conflict(덮어쓰지 않음)
//   - 런타임 비밀 없음 → 503 not_configured(쓰기 없음)
// - 플랫폼 오너만. 미로그인·다른 사용자는 존재를 숨기기 위해 모든 메서드 404(OPTIONS 포함 — 405·Allow 헤더로 드러나지 않게).
// - 의도적으로 어떤 클라이언트 컴포넌트에서도 호출하지 않는다: 미사용 엔드포인트 점검의 문서화된 예외(대장 결정 2026-11-10).
// - 내부 오류(DB 등)는 고정 본문 500, 서버 로그엔 코드만. 응답·로그에 비밀값 없음(kid는 비밀이 아님).
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isPlatformOwner } from '@/lib/channel-credentials';
import { AnchorError, credentialKeyStatus, setAnchor } from '@/lib/credentials/anchor';
import { credentialKeyId, CredentialCryptoError } from '@/lib/crypto/credentials';
import { logAudit } from '@/lib/audit/logger';
import { prisma } from '@/lib/prisma';
import { hasSameOriginProof } from '@/lib/security/origin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
const hidden = () => fail(404, 'not_found', '대상을 찾을 수 없습니다.');

/** 플랫폼 오너 userId, 아니면 null(미로그인 포함). 세션 저장소 장애 등은 그대로 던진다(404로 숨기지 않음). */
async function platformOwner(): Promise<string | null> {
  let userId: string;
  try { userId = (await requireSession()).user.id; }
  catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return null;
    throw error;
  }
  return (await isPlatformOwner(userId)) ? userId : null;
}

export async function GET() {
  try {
    if (!(await platformOwner())) return hidden();
    return NextResponse.json(await credentialKeyStatus(), { headers: NO_STORE });
  } catch {
    console.error('[credentials] key status failed', { code: 'internal_error' });
    return NextResponse.json({ error: { code: 'internal_error', message: '처리하지 못했습니다.' } }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  try {
    const owner = await platformOwner();
    if (!owner) return hidden();
    if (!hasSameOriginProof(request)) return fail(403, 'forbidden_origin', '허용되지 않은 요청 출처입니다.');
    if (process.env.VERCEL_ENV !== 'production') return fail(403, 'not_production', '운영 배포에서만 앵커를 만들 수 있습니다.');
    let kid: string;
    try { kid = credentialKeyId(); }
    catch (error) {
      if (error instanceof CredentialCryptoError) return fail(503, 'not_configured', '운영 런타임에 자격증명 키가 설정되지 않았습니다.');
      throw error;
    }
    let result: Awaited<ReturnType<typeof setAnchor>>;
    try { result = await setAnchor(prisma, kid); }
    catch (error) {
      if (error instanceof AnchorError && error.code === 'anchor_conflict') {
        const status = await credentialKeyStatus();
        return fail(409, 'anchor_conflict', '이미 다른 키로 앵커가 고정되어 있습니다. 덮어쓰지 않습니다.', { kid: status.kid, anchorKid: status.anchorKid });
      }
      throw error;
    }
    if (result === 'created') await logAudit({ actor: owner, action: 'credentials.anchor.set', targetType: 'credential_key_anchor', targetId: 'default' });
    return NextResponse.json({ result, ...(await credentialKeyStatus()) }, { headers: NO_STORE });
  } catch {
    console.error('[credentials] anchor write failed', { code: 'internal_error' });
    return fail(500, 'internal_error', '처리하지 못했습니다.');
  }
}
export const PUT = hidden;
export const PATCH = hidden;
export const DELETE = hidden;
// OPTIONS를 직접 export하지 않으면 Next가 Allow 헤더(구현 메서드 목록)로 자동 응답해 경로 존재가 드러난다
export const OPTIONS = hidden;
