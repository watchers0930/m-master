// PATCH  /api/schedule/slots/:id → 슬롯 수정
// DELETE /api/schedule/slots/:id → 슬롯 삭제

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const updates = await req.json();

  try {
    const data = await prisma.scheduleSlot.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    await prisma.scheduleSlot.delete({ where: { id } });
    return NextResponse.json({ data: null, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
