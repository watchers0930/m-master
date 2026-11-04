import { z } from 'zod';
import { authenticated, notFound, VisibilityError } from '@/lib/visibility/http';
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

const scheduleSchema = z.object({ scheduledAt: z.iso.datetime({ offset: true }).nullable() }).strict();
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => {
    const { id } = await params;
    const { scheduledAt } = scheduleSchema.parse(await req.json());
    const job = await prisma.$transaction(async tx => {
      // The document lock serializes first-job creation, where no job exists to lock yet.
      await tx.$queryRaw`SELECT id FROM idea_documents WHERE id=${id} AND owner_id=${ownerId} FOR UPDATE`;
      const doc = await tx.ideaDocument.findFirst({ where: { id, ownerId } });
      if (!doc) notFound();
      const existing = await tx.ideaPublishJob.findUnique({ where: { docId: id } });
      if (existing) {
        await tx.$queryRaw`SELECT id FROM idea_publish_jobs WHERE id=${existing.id} AND owner_id=${ownerId} FOR UPDATE`;
        const claimed = await tx.publishClaim.findFirst({ where: { ownerId, targetType:'idea_job', targetId:existing.id,
          status:{ in:['claimed','unknown','sent'] } }, select:{ id:true } });
        if (claimed || existing.status === 'done') throw new VisibilityError('publish_in_progress','발행 기록이 있는 문서는 재예약할 수 없습니다.',409);
      }
      if (!scheduledAt) {
        if (existing) await tx.ideaPublishJob.delete({ where: { id:existing.id } });
        return null;
      }
      // Preserve identity so previous claims cannot be bypassed with a new job ID.
      return tx.ideaPublishJob.upsert({ where:{ docId:id },
        create:{ ownerId,docId:id,title:doc.title || '(제목 없음)',bodyHtml:doc.body,channel:doc.channel,
          status:'pending',scheduledAt:new Date(scheduledAt) },
        update:{ title:doc.title || '(제목 없음)',bodyHtml:doc.body,channel:doc.channel,
          status:'pending',scheduledAt:new Date(scheduledAt),finishedAt:null },
      });
    });
    return NextResponse.json({ data:job }, { status:job ? 201 : 200 });
  }, req, { requireOrigin:true });
}
