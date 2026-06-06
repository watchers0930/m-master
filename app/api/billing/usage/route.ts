// GET /api/billing/usage — 이번 달 사용량 조회
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await requireSession();
  const userId = session.user.id;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  });

  const [contentCount, costAgg] = await Promise.all([
    prisma.content.count({
      where: { ownerId: userId, createdAt: { gte: monthStart } },
    }),
    prisma.costLedger.aggregate({
      where: { ownerId: userId, occurredAt: { gte: monthStart } },
      _sum: { krw: true },
    }),
  ]);

  return NextResponse.json({
    data: {
      plan: user?.plan ?? 'free',
      contentCount,
      costKrw: Math.round(costAgg._sum.krw ?? 0),
    },
    error: null,
  });
}
