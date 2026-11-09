// GET /api/auth/ga4/callback — Google OAuth 콜백 (토큰 교환 → DB 저장)
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSession } from '@/lib/auth';
import { writeChannelCredential } from '@/lib/credentials/store';
import { CredentialCryptoError } from '@/lib/crypto/credentials';

function verifyState(state: string): { uid: string } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString();
    const dotIdx = decoded.lastIndexOf('.');
    const payload = decoded.slice(0, dotIdx);
    const hmac = decoded.slice(dotIdx + 1);
    const secret = process.env.NEXTAUTH_SECRET ?? '';
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    const data = JSON.parse(payload);
    if (Date.now() - data.ts > 10 * 60 * 1000) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://m-master.vercel.app';
  const settingsUrl = `${baseUrl}/settings`;

  // 1) 세션 검증
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.redirect(`${settingsUrl}?ga4=auth_error`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${settingsUrl}?ga4=denied`);
  }

  // 2) state 검증 (CSRF 방지)
  const stateData = verifyState(state);
  if (!stateData || stateData.uid !== session.user.id) {
    return NextResponse.redirect(`${settingsUrl}?ga4=invalid_state`);
  }

  // 3) authorization code → refresh token 교환
  const clientId = process.env.GA4_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET ?? '';

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${baseUrl}/api/auth/ga4/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json() as Record<string, unknown>;

  if (tokenData.error || !tokenData.refresh_token) {
    // 응답 본문에는 access_token이 섞여 있을 수 있으므로 오류 코드만 남긴다
    console.error('[ga4-oauth] Token exchange failed:', { error: typeof tokenData.error === 'string' ? tokenData.error : 'no_refresh_token' });
    return NextResponse.redirect(`${settingsUrl}?ga4=token_error`);
  }

  const refreshToken = tokenData.refresh_token as string;

  // 4) DB 저장 (비밀 필드 암호화 — 키 미설정이면 저장 거부)
  try {
    await writeChannelCredential(session.user.id, 'ga4', {
      refreshToken,
      meta: { client_id: clientId, client_secret: clientSecret },
      accessToken: (tokenData.access_token as string) ?? null,
      expiresAt: tokenData.expires_in ? String(Date.now() + Number(tokenData.expires_in) * 1000) : null,
    });
  } catch (error) {
    if (!(error instanceof CredentialCryptoError)) throw error;
    console.error('[credentials] encrypt failed', { channel: 'ga4', reason: error.reason });
    return NextResponse.redirect(`${settingsUrl}?ga4=save_error`);
  }

  return NextResponse.redirect(`${settingsUrl}?ga4=connected`);
}
