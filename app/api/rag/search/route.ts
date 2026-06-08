// app/api/rag/search/route.ts
// GET /api/rag/search?q=검색어&k=5
// 인증 필수 — ownerId 기반 소유권 필터

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { retrieveTopK } from '@/lib/rag/retriever';
import { calcEmbeddingKrw } from '@/lib/openai/embedding';
import { trackCost } from '@/lib/cost/tracker';
import { checkFeatureAccess, getUserPlan } from '@/lib/billing/limits';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  // 플랜 기능 체크 (RAG는 starter 이상)
  const plan = await getUserPlan(ownerId);
  try {
    checkFeatureAccess(plan, 'rag');
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: 'plan_limit', message: err instanceof Error ? err.message : '플랜 제한' } },
      { status: 403 },
    );
  }

  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q')?.trim() ?? '';
  const k = Math.min(Math.max(Number(searchParams.get('k')) || 5, 1), 20);

  if (!q) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_INPUT', message: '검색어(q)를 입력해주세요' } },
      { status: 400 },
    );
  }

  const { chunks, queryTokens } = await retrieveTopK({ query: q, ownerId, k });

  // 검색 임베딩 비용 기록
  if (queryTokens > 0) {
    const krw = calcEmbeddingKrw(queryTokens);
    await trackCost({ ownerId, kind: 'embedding', tokensIn: queryTokens, tokensOut: 0, krw });
  }

  return NextResponse.json({ data: { chunks }, error: null });
}
