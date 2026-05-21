// GET /api/content/[id]/download — 콘텐츠를 단일 HTML 파일로 다운로드
import { NextRequest, NextResponse } from 'next/server';
import { generateBlogHtml } from '@/lib/publish/blog-html';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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
