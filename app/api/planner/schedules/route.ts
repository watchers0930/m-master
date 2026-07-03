import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const { title, scheduledDate, category } = await req.json();
    if (!title || !scheduledDate)
      return NextResponse.json({ error: '제목과 날짜를 입력하세요.' }, { status: 400 });

    const item = await prisma.ideaSchedule.create({
      data: {
        ownerId: session.user.id,
        title,
        scheduledDate,
        category: category ?? 'general',
        status: 'planned',
      },
    });
    return NextResponse.json({ data: item }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
