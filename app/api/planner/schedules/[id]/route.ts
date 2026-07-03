import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.ideaSchedule.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== session.user.id)
      return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });

    const data: Record<string, unknown> = {};
    if ('status' in body) data.status = body.status;
    if ('title' in body) data.title = body.title;

    const item = await prisma.ideaSchedule.update({ where: { id }, data });
    return NextResponse.json({ data: item });
  } catch {
    return NextResponse.json({ error: '수정에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const existing = await prisma.ideaSchedule.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== session.user.id)
      return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });

    await prisma.ideaSchedule.delete({ where: { id } });
    return NextResponse.json({ data: { ok: true } });
  } catch {
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
