import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

    const job = await prisma.ideaPublishJob.findUnique({ where: { id } });
    if (!job || job.ownerId !== session.user.id)
      return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });

    await prisma.ideaPublishJob.delete({ where: { id } });
    return NextResponse.json({ data: { ok: true } });
  } catch {
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
