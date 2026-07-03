import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

async function getOwnedDoc(id: string, userId: string) {
  const doc = await prisma.ideaDocument.findUnique({ where: { id } });
  if (!doc || doc.ownerId !== userId) return null;
  return doc;
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const doc = await prisma.ideaDocument.findUnique({
      where: { id },
      include: { publishJob: true },
    });
    if (!doc || doc.ownerId !== session.user.id)
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ data: doc });
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const existing = await getOwnedDoc(id, session.user.id);
    if (!existing) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

    const body = await req.json();
    const allowed = ['title', 'body', 'channel', 'status', 'notes', 'bodyImageUrls'] as const;
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    const doc = await prisma.ideaDocument.update({ where: { id }, data });
    return NextResponse.json({ data: doc });
  } catch {
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const existing = await getOwnedDoc(id, session.user.id);
    if (!existing) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

    await prisma.ideaDocument.delete({ where: { id } });
    return NextResponse.json({ data: { ok: true } });
  } catch {
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
