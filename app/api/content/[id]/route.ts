// GET /api/content/[id] — 단건 콘텐츠 조회
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toSnakeCase } from '@/lib/utils/case';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const { id } = await params;

  try {
    const row = await prisma.content.findUnique({ where: { id } });

    if (!row || row.ownerId !== ownerId) {
      return NextResponse.json(
        { data: null, error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: toSnakeCase(row), error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { data: null, error: { code: 'db_error', message } },
      { status: 500 },
    );
  }
}
