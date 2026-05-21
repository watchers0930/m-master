// GET /api/content — contents 목록 조회
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status    = searchParams.get('status') ?? undefined;
  const channel   = searchParams.get('channel') ?? undefined;
  const page      = parseInt(searchParams.get('page') ?? '1', 10);
  const per_page  = parseInt(searchParams.get('per_page') ?? '50', 10);

  try {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (channel) where.channel = channel;

    const [items, total] = await Promise.all([
      prisma.content.findMany({
        where,
        select: {
          id: true,
          channel: true,
          topic: true,
          status: true,
          scores: true,
          costKrw: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      prisma.content.count({ where }),
    ]);

    return NextResponse.json({
      data: { items, total, page, per_page },
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { data: null, error: { code: 'db_error', message } },
      { status: 500 },
    );
  }
}
