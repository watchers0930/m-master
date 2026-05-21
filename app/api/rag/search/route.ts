// app/api/rag/search/route.ts
// GET ?q=&k=5 → pgvector cosine top-K 검색
// 인증 필수

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { retrieveTopK } from '@/lib/rag/retriever';

const QuerySchema = z.object({
  q: z.string().min(1, 'q 파라미터 필수'),
  k: z.coerce.number().int().min(1).max(20).default(5),
});

export async function GET(request: NextRequest) {
  // 1) 세션 검증
  const session = await requireSession();
  const ownerId = session.user.id;

  // 2) 쿼리 파라미터 검증
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    q: searchParams.get('q') ?? '',
    k: searchParams.get('k') ?? 5,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { q, k } = parsed.data;

  // 3) pgvector 검색
  let chunks;
  try {
    chunks = await retrieveTopK({
      query: q,
      ownerId,
      k,
    });
  } catch (err) {
    console.error('[rag/search] retrieval error:', err);
    return NextResponse.json(
      { error: { code: 'internal', message: 'RAG 검색 실패' } },
      { status: 500 },
    );
  }

  const response = chunks.map((c) => ({
    id: c.id,
    text: c.content,
    similarity: c.similarity,
  }));

  return NextResponse.json({ data: { chunks: response }, error: null });
}
