// GET /api/content/[id]/download — 콘텐츠를 단일 HTML 파일로 다운로드
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateBlogHtml } from '@/lib/publish/blog-html';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const { id } = await params;

  // 소유권 검증
  const content = await prisma.content.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!content || content.ownerId !== ownerId) {
    return NextResponse.json(
      { data: null, error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } },
      { status: 404 },
    );
  }

  try {
    const { html, filename } = await generateBlogHtml(id);
    const encodedFilename = encodeURIComponent(filename);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json(
      { data: null, error: { code: 'download_failed', message } },
      { status: 500 },
    );
  }
}
