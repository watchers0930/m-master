// GET  /api/schedule/slots?year=2026&month=5  → 월별 슬롯 목록
// POST /api/schedule/slots                     → 슬롯 생성 (단건 or 배열)
// DELETE /api/schedule/slots?year=2026&month=5 → 월 전체 초기화

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/* Prisma returns camelCase; frontend expects snake_case */
function toSnake(row: Record<string, unknown>) {
  return {
    id:           row.id,
    content_id:   row.contentId ?? null,
    channel:      row.channel,
    scheduled_at: row.scheduledAt,
    published_at: row.publishedAt ?? null,
    status:       row.status,
    mode:         row.mode,
    external_id:  row.externalId ?? null,
    external_url: row.externalUrl ?? null,
    retry_count:  row.retryCount ?? 0,
    last_error:   row.lastError ?? null,
    created_at:   row.createdAt,
    content:      row.content ?? null,
  };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year');
  const month = searchParams.get('month');

  try {
    const where: Record<string, unknown> = { ownerId };

    if (year && month) {
      const y = Number(year), m = Number(month);
      const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const to = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00Z`);
      where.scheduledAt = { gte: from, lt: to };
    }

    const rows = await prisma.scheduleSlot.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: { content: { select: { topic: true } } },
    });

    const data = rows.map((r) => toSnake(r as unknown as Record<string, unknown>));
    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;
  try {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : [body];

    const created = await prisma.$transaction(
      rows.map((row: Record<string, unknown>) =>
        prisma.scheduleSlot.create({
          data: {
            ownerId,
            contentId:   (row.content_id ?? row.contentId ?? null) as string | null,
            channel:     row.channel as string,
            scheduledAt: new Date((row.scheduled_at ?? row.scheduledAt) as string),
            status:      (row.status as string) ?? 'scheduled',
            mode:        (row.mode as string) ?? 'manual',
          },
        }),
      ),
    );

    const data = created.map((r) => toSnake(r as unknown as Record<string, unknown>));
    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year');
  const month = searchParams.get('month');

  if (!year || !month) {
    return NextResponse.json({ data: null, error: 'year, month 필수' }, { status: 400 });
  }

  try {
    const y = Number(year), m = Number(month);
    const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const to = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00Z`);

    await prisma.scheduleSlot.deleteMany({
      where: {
        ownerId,
        scheduledAt: { gte: from, lt: to },
      },
    });

    return NextResponse.json({ data: null, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
