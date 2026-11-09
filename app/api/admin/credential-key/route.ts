// GET /api/admin/credential-key — 운영 런타임의 자격증명 키 식별자(kid) 확인(읽기 전용)
// 운영 이전 시 "운영 앱이 실제로 쓰는 키 = CREDENTIAL_KEY_ID = 로컬 키" 를 값 노출 없이 대조하기 위한 유일한 수단.
// 플랫폼 오너만 200. 미로그인·다른 사용자는 존재 자체를 숨기기 위해 404. 응답·로그에 비밀값 없음(kid는 비밀이 아님).
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isPlatformOwner } from '@/lib/channel-credentials';
import { credentialKeyStatus } from '@/lib/crypto/credentials';

export const dynamic = 'force-dynamic';

const hidden = () => NextResponse.json({ error: { code: 'not_found', message: '대상을 찾을 수 없습니다.' } }, { status: 404 });

export async function GET() {
  let userId: string;
  try { userId = (await requireSession()).user.id; } catch { return hidden(); }
  if (!(await isPlatformOwner(userId))) return hidden();
  return NextResponse.json(credentialKeyStatus(), { headers: { 'Cache-Control': 'no-store' } });
}
