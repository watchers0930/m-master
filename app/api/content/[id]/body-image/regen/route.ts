// POST /api/content/[id]/body-image/regen
// 본문 이미지 개별 재생성 — 같은 설명으로 Unsplash 검색해서 새 URL로 교체
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { searchOne } from '@/lib/unsplash/search';
import { translateImagePrompts } from '@/lib/claude/translate';
import { checkCostLimit, getUserPlan } from '@/lib/billing/limits';

const RequestSchema = z.object({
  index: z.number().int().min(0).max(50),
  description: z.string().min(1).max(500),
});

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('bad_request', 'JSON 파싱 실패', 400); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);

  const { index, description } = parsed.data;

  // 기존 row 조회
  const row = await prisma.content.findUnique({
    where: { id },
    select: { ownerId: true, bodyImageUrls: true },
  });

  if (!row) return jsonError('not_found', '콘텐츠를 찾을 수 없습니다', 404);
  if (row.ownerId !== ownerId) return jsonError('forbidden', '권한 없음', 403);

  // 비용 한도 체크
  const plan = await getUserPlan(ownerId);
  try {
    await checkCostLimit(ownerId, plan);
  } catch (err) {
    return jsonError('plan_limit', err instanceof Error ? err.message : '플랜 한도 초과', 429);
  }

  const currentUrls = Array.isArray(row.bodyImageUrls) ? [...(row.bodyImageUrls as string[])] : [];
  if (index >= currentUrls.length) {
    // 배열보다 큰 index — 부족하면 빈 슬롯으로 채움
    while (currentUrls.length <= index) currentUrls.push('');
  }

  // 한국어 → 영어 번역 (단일 항목)
  let englishQuery = description;
  try {
    const { queries } = await translateImagePrompts([description]);
    englishQuery = queries[0] ?? description;
  } catch (err) {
    console.warn('[regen] 번역 실패, 한국어로 검색 시도:', err);
  }

  // Unsplash 검색 — 랜덤 페이지로 다른 결과 노출
  let newUrl: string | null = null;
  try {
    newUrl = await searchOne(englishQuery, { page: Math.floor(Math.random() * 5) + 1 });
  } catch (err) {
    console.warn('[regen] Unsplash 검색 실패:', err);
  }

  if (!newUrl) {
    return jsonError('not_found_image', '대체 이미지를 찾지 못했습니다', 404);
  }

  currentUrls[index] = newUrl;

  // DB 업데이트
  await prisma.content.update({
    where: { id },
    data: { bodyImageUrls: currentUrls },
  });

  return new Response(JSON.stringify({ data: { url: newUrl, index } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
