// GET /api/settings/ga4 — GA4 연동 상태 조회
// DELETE /api/settings/ga4 — GA4 연결 해제
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await requireSession();

  const cred = await prisma.channelCredential.findUnique({
    where: { ownerId_channel: { ownerId: session.user.id, channel: 'ga4' } },
    select: { updatedAt: true },
  });

  return NextResponse.json({
    ga4_property_id: process.env.GA4_PROPERTY_ID ?? '',
    connected: !!cred,
    updated_at: cred?.updatedAt?.toISOString() ?? null,
  });
}

export async function DELETE() {
  const session = await requireSession();

  await prisma.channelCredential.deleteMany({
    where: { ownerId: session.user.id, channel: 'ga4' },
  });

  return NextResponse.json({ ok: true });
}
