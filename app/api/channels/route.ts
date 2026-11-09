// app/api/channels/route.ts — 채널 자격증명 CRUD + 연결 검증
// POST: 저장 + 검증, DELETE: 연결 해제

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { deleteChannelCredential, listMaskedCredentials, writeChannelCredential, type CredentialInput } from '@/lib/credentials/store';
import { CredentialCryptoError } from '@/lib/crypto/credentials';
import { logAudit } from '@/lib/audit/logger';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';

async function verifyMetaToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me?access_token=${token}`,
      { cache: 'no-store' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function verifyNaverToken(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 암호화 저장 실패(키 미설정 등)는 평문 저장으로 우회하지 않고 503으로 거부한다. 값은 로그에 남기지 않는다.
async function saveCredential(ownerId: string, channel: string, data: CredentialInput): Promise<NextResponse | null> {
  try {
    await writeChannelCredential(ownerId, channel, data);
    return null;
  } catch (error) {
    if (!(error instanceof CredentialCryptoError)) throw error;
    console.error('[credentials] encrypt failed', { channel, reason: error.reason });
    return NextResponse.json({ error: { code: 'credential_storage_unavailable', message: '자격증명을 안전하게 저장할 수 없습니다. 관리자에게 문의하세요.' } }, { status: 503 });
  }
}

// ── GET: 채널 목록 + 마스킹된 자격증명 ──────────────────────────────
export async function GET() {
  const session = await requireSession();
  const ownerId = session.user.id;

  // 본인 행만, 복호화 후 마스킹(암호문을 마스킹하지 않는다). 복호화 실패는 throw(500) — 값으로 숨기지 않는다.
  const channels = await listMaskedCredentials(ownerId);

  return NextResponse.json({ data: channels, error: null });
}

// ── POST: 자격증명 저장 + 실시간 검증 ───────────────────────────────
const NaverSchema = z.object({
  channel: z.literal('naver_cafe'),
  clientId: z.string().optional().default(''),
  clientSecret: z.string().optional().default(''),
  accessToken: z.string().min(1, 'Access Token은 필수입니다'),
  refreshToken: z.string().optional().default(''),
  clubId: z.string().min(1, '카페 ID는 필수입니다'),
  menuId: z.string().min(1, '게시판 메뉴 ID는 필수입니다'),
});

const InstagramSchema = z.object({
  channel: z.literal('instagram'),
  accessToken: z.string().min(1, 'Access Token은 필수입니다'),
  businessId: z.string().min(1, 'Business Account ID는 필수입니다'),
});

const FacebookSchema = z.object({
  channel: z.literal('facebook'),
  accessToken: z.string().min(1, 'Access Token은 필수입니다'),
  pageId: z.string().min(1, 'Page ID는 필수입니다'),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const { channel } = body as { channel?: string };

  // ── 네이버 카페 ──
  if (channel === 'naver_cafe') {
    const parsed = NaverSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'validation', message: parsed.error.issues[0]?.message } }, { status: 400 });
    }
    const d = parsed.data;
    const ok = await verifyNaverToken(d.accessToken);
    if (!ok) {
      return NextResponse.json({ error: { code: 'verify_failed', message: '네이버 Access Token 검증 실패. 토큰 값을 확인하세요.' } }, { status: 400 });
    }
    const failed = await saveCredential(ownerId, 'naver_cafe', { accessToken: d.accessToken, refreshToken: d.refreshToken || null, meta: { clientId: d.clientId, clientSecret: d.clientSecret, clubId: d.clubId, menuId: d.menuId } });
    if (failed) return failed;
    await logAudit({ actor: session.user.id, action: 'channel.connect', targetType: 'channel', targetId: 'naver_cafe' });
    return NextResponse.json({ data: { ok: true, message: '네이버 카페 연결 완료' }, error: null });
  }

  // ── Instagram ──
  if (channel === 'instagram') {
    const parsed = InstagramSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'validation', message: parsed.error.issues[0]?.message } }, { status: 400 });
    }
    const d = parsed.data;
    const ok = await verifyMetaToken(d.accessToken);
    if (!ok) {
      return NextResponse.json({ error: { code: 'verify_failed', message: 'Instagram Access Token 검증 실패. Meta Graph API Explorer에서 토큰을 확인하세요.' } }, { status: 400 });
    }
    const failed = await saveCredential(ownerId, 'instagram', { accessToken: d.accessToken, meta: { businessId: d.businessId } });
    if (failed) return failed;
    await logAudit({ actor: session.user.id, action: 'channel.connect', targetType: 'channel', targetId: 'instagram' });
    return NextResponse.json({ data: { ok: true, message: 'Instagram 연결 완료' }, error: null });
  }

  // ── Facebook ──
  if (channel === 'facebook') {
    const parsed = FacebookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'validation', message: parsed.error.issues[0]?.message } }, { status: 400 });
    }
    const d = parsed.data;
    const ok = await verifyMetaToken(d.accessToken);
    if (!ok) {
      return NextResponse.json({ error: { code: 'verify_failed', message: 'Facebook Access Token 검증 실패. 페이지 토큰을 확인하세요.' } }, { status: 400 });
    }
    const failed = await saveCredential(ownerId, 'facebook', { accessToken: d.accessToken, meta: { pageId: d.pageId } });
    if (failed) return failed;
    await logAudit({ actor: session.user.id, action: 'channel.connect', targetType: 'channel', targetId: 'facebook' });
    return NextResponse.json({ data: { ok: true, message: 'Facebook 연결 완료' }, error: null });
  }

  return NextResponse.json({ error: { code: 'bad_request', message: '지원하지 않는 채널입니다.' } }, { status: 400 });
}

// ── DELETE: 연결 해제 ────────────────────────────────────────────────
const DeleteSchema = z.object({
  channel: z.enum(['naver_cafe', 'instagram', 'facebook']),
});

export async function DELETE(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation', message: '유효하지 않은 채널명입니다.' } }, { status: 400 });
  }

  await deleteChannelCredential(ownerId, parsed.data.channel);
  await logAudit({ actor: session.user.id, action: 'channel.disconnect', targetType: 'channel', targetId: parsed.data.channel });

  return NextResponse.json({ data: { ok: true }, error: null });
}
