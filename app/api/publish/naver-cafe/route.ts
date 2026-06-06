// app/api/publish/naver-cafe/route.ts
// POST { content_id, cafe_target_ids? } → 네이버 카페 발행 (다중 카페 지원)
// cafe_target_ids 없으면 기본 카페 1건, 있으면 해당 카페들에 10초 간격 순차 발행

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publishNaverCafePost } from '@/lib/publish/naver-cafe';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const RequestSchema = z.object({
  content_id: z.string().min(1, 'content_id는 필수입니다'),
  cafe_target_ids: z.array(z.string()).optional(),
});

interface CafePublishResult {
  targetId: string;
  name: string;
  articleId?: string;
  url?: string;
  error?: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { content_id, cafe_target_ids } = parsed.data;

  const content = await prisma.content.findFirst({
    where: { id: content_id, ownerId },
    select: { id: true, textBody: true, topic: true, keywords: true, bodyImageUrls: true },
  });

  if (!content) {
    return NextResponse.json({ error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } }, { status: 404 });
  }

  const subject = content.topic || '새 게시글';
  const contentText = content.textBody || content.topic || '';
  const imageUrls = (content.bodyImageUrls ?? []).filter((u: string) => u && u.trim() !== '');

  // 발행 대상 카페 결정
  let targets: { id: string; name: string; clubId: string; menuId: string }[];

  if (cafe_target_ids && cafe_target_ids.length > 0) {
    // 지정된 카페 타겟들
    const found = await prisma.cafeTarget.findMany({
      where: { id: { in: cafe_target_ids }, ownerId },
      orderBy: { createdAt: 'asc' },
    });
    targets = found;
  } else {
    // 기본 카페 (isDefault=true) 또는 첫 번째 카페
    const defaultTarget = await prisma.cafeTarget.findFirst({
      where: { isDefault: true, ownerId },
    });
    if (defaultTarget) {
      targets = [defaultTarget];
    } else {
      // CafeTarget이 없으면 기존 방식 (credential에서 clubId/menuId)으로 단건 발행
      try {
        const publishResult = await publishNaverCafePost({ subject, content: contentText, keywords: content.keywords, imageUrls, ownerId });
        const now = new Date().toISOString();
        try {
          await prisma.scheduleSlot.create({
            data: {
              ownerId,
              contentId: content_id, channel: 'naver_cafe',
              scheduledAt: now, publishedAt: now,
              status: 'published', mode: 'manual',
              externalId: publishResult.articleId, externalUrl: publishResult.cafeUrl,
            },
          });
        } catch (e) { console.error('[publish/naver-cafe] slot insert 실패:', e); }

        await logAudit({
          actor: ownerId, action: AUDIT_ACTIONS.PUBLISH_NAVER_CAFE,
          targetType: 'content', targetId: content_id,
          payload: { article_id: publishResult.articleId, cafe_url: publishResult.cafeUrl },
        });

        return NextResponse.json({ data: { id: publishResult.articleId, url: publishResult.cafeUrl }, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: { code: 'publish_failed', message: msg } }, { status: 502 });
      }
    }
  }

  // 다중 카페 순차 발행 (10초 간격)
  const results: CafePublishResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    // 두 번째 카페부터 10초 대기 (스팸 필터 방지)
    if (i > 0) await sleep(10_000);

    try {
      const publishResult = await publishNaverCafePost({
        subject, content: contentText, keywords: content.keywords, imageUrls,
        clubId: target.clubId, menuId: target.menuId, ownerId,
      });

      const now = new Date().toISOString();
      try {
        await prisma.scheduleSlot.create({
          data: {
            ownerId,
            contentId: content_id, channel: 'naver_cafe',
            scheduledAt: now, publishedAt: now,
            status: 'published', mode: 'manual',
            targetName: target.name,
            externalId: publishResult.articleId, externalUrl: publishResult.cafeUrl,
          },
        });
      } catch (e) { console.error(`[publish/naver-cafe] slot insert 실패 (${target.name}):`, e); }

      await logAudit({
        actor: ownerId, action: AUDIT_ACTIONS.PUBLISH_NAVER_CAFE,
        targetType: 'content', targetId: content_id,
        payload: { target_name: target.name, article_id: publishResult.articleId, cafe_url: publishResult.cafeUrl },
      });

      results.push({
        targetId: target.id, name: target.name,
        articleId: publishResult.articleId, url: publishResult.cafeUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[publish/naver-cafe] ${target.name} 발행 실패:`, msg);
      results.push({ targetId: target.id, name: target.name, error: msg });
    }
  }

  const hasError = results.some(r => r.error);
  return NextResponse.json({
    data: { results },
    error: hasError ? { code: 'partial_failure', message: '일부 카페 발행 실패' } : null,
  });
}
