import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()));
    const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endYear = month === 12 ? year + 1 : year;
    const endMonth = month === 12 ? 1 : month + 1;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

    const [plans, jobs] = await Promise.all([
      prisma.ideaSchedule.findMany({
        where: {
          ownerId: session.user.id,
          scheduledDate: { gte: startDate, lt: endDate },
        },
        orderBy: { scheduledDate: 'asc' },
      }),
      prisma.ideaPublishJob.findMany({
        where: {
          ownerId: session.user.id,
          scheduledAt: {
            gte: new Date(`${startDate}T00:00:00.000Z`),
            lt: new Date(`${endDate}T00:00:00.000Z`),
          },
        },
        orderBy: { scheduledAt: 'asc' },
      }),
    ]);

    const entries = [
      ...plans.map((p) => ({
        kind: 'plan' as const,
        id: p.id,
        title: p.title,
        date: p.scheduledDate,
        status: p.status,
        category: p.category,
      })),
      ...jobs.map((j) => ({
        kind: 'publish' as const,
        id: j.id,
        title: j.title,
        date: j.scheduledAt!.toISOString().slice(0, 10),
        status: j.status,
        externalUrl: j.externalUrl,
        docId: j.docId,
        channel: j.channel,
      })),
    ];

    return NextResponse.json({ data: entries });
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }
}
