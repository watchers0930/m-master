// GET /api/content/[id] — 단건 콘텐츠 조회
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const data = await prisma.content.findUnique({ where: { id } });

    if (!data) {
      return NextResponse.json(
        { data: null, error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } },
        { status: 404 },
      );
    }

    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { data: null, error: { code: 'db_error', message } },
      { status: 500 },
    );
  }
}
