import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const doc = await prisma.ideaDocument.findUnique({ where: { id } });
    if (!doc || doc.ownerId !== session.user.id)
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

    const job = await prisma.ideaPublishJob.findUnique({ where: { docId: id } });
    return NextResponse.json({ data: job ?? null });
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const doc = await prisma.ideaDocument.findUnique({ where: { id } });
    if (!doc || doc.ownerId !== session.user.id)
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

    const { scheduledAt } = await req.json();

    // 기존 잡 제거 후 재생성 (null = 예약 취소)
    await prisma.ideaPublishJob.deleteMany({ where: { docId: id } });

    if (!scheduledAt) return NextResponse.json({ data: null });

    const job = await prisma.ideaPublishJob.create({
      data: {
        ownerId: session.user.id,
        docId: id,
        title: doc.title || '(제목 없음)',
        bodyHtml: doc.body,
        channel: doc.channel,
        status: 'pending',
        scheduledAt: new Date(scheduledAt),
      },
    });
    return NextResponse.json({ data: job }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '예약에 실패했습니다.' }, { status: 500 });
  }
}
