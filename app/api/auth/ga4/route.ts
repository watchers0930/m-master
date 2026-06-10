// GET /api/auth/ga4 — Google OAuth 시작 (GA4 연동)
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSession } from '@/lib/auth';

function createState(ownerId: string): string {
  const payload = JSON.stringify({ uid: ownerId, ts: Date.now() });
  const secret = process.env.NEXTAUTH_SECRET ?? '';
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${hmac}`).toString('base64url');
}

export async function GET() {
  const session = await requireSession();
  const baseUrl = process.env.NEXTAUTH_URL || 'https://m-master.vercel.app';
  const clientId = process.env.GA4_OAUTH_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json({ error: 'GA4 OAuth client not configured' }, { status: 500 });
  }

  const state = createState(session.user.id);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl}/api/auth/ga4/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
