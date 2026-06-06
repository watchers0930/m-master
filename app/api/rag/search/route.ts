// app/api/rag/search/route.ts
// GET /api/rag/search?q=검색어&k=5
// 인증 필수 — ownerId 기반 소유권 필터

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { retrieveTopK } from '@/lib/rag/retriever';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q')?.trim() ?? '';
  const k = Math.min(Math.max(Number(searchParams.get('k')) || 5, 1), 20);

  if (!q) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_INPUT', message: '검색어(q)를 입력해주세요' } },
      { status: 400 },
    );
  }

  const chunks = await retrieveTopK({ query: q, ownerId, k });

  return NextResponse.json({ data: { chunks }, error: null });
}
