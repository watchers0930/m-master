// GET  /api/schedule/slots?year=2026&month=5  → 월별 슬롯 목록
// POST /api/schedule/slots                     → 슬롯 생성 (단건 or 배열)
// DELETE /api/schedule/slots?year=2026&month=5 → 월 전체 초기화

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year');
  const month = searchParams.get('month');

  try {
    const where: Record<string, unknown> = {};

    if (year && month) {
      const y = Number(year), m = Number(month);
      const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const to = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00Z`);
      where.scheduledAt = { gte: from, lt: to };
    }

    const data = await prisma.scheduleSlot.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: { content: { select: { topic: true } } },
    });

    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : [body];

    const data = await prisma.$transaction(
      rows.map((row: Record<string, unknown>) =>
        prisma.scheduleSlot.create({ data: row as never }),
      ),
    );

    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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
        scheduledAt: { gte: from, lt: to },
      },
    });

    return NextResponse.json({ data: null, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
