import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await requireSession();
    const docs = await prisma.ideaDocument.findMany({
      where: { ownerId: session.user.id },
      include: { publishJob: { select: { id: true, status: true, scheduledAt: true, externalUrl: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ data: docs });
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();

    const doc = await prisma.ideaDocument.create({
      data: {
        ownerId: session.user.id,
        title: body.title ?? '',
        body: body.body ?? '<p><br></p>',
        channel: body.channel ?? 'blog',
        status: 'draft',
        notes: body.notes ?? null,
        bodyImageUrls: body.bodyImageUrls ?? [],
      },
    });
    return NextResponse.json({ data: doc }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
