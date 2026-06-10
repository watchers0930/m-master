// app/api/blog-publish/complete/route.ts — 블로그 발행 완료 보고
// GitHub Actions Playwright 스크립트가 발행 성공 후 호출
// 인증: x-api-key 헤더 (BLOG_PUBLISH_API_KEY 환경변수)
// 블로그 발행 완료 시 → 같은 토픽으로 카페 자동 발행 트리거

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { publishNaverCafePost } from '@/lib/publish/naver-cafe';
import { getNaverCafeCreds, getCafeTargets } from '@/lib/channel-credentials';
import { trackCost } from '@/lib/cost/tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function verifyApiKey(req: NextRequest): boolean {
  const key = process.env.BLOG_PUBLISH_API_KEY;
  if (!key) return false;
  return req.headers.get('x-api-key') === key;
}

interface CompleteBody {
  contentId: string;
  externalUrl: string;
}

export async function POST(req: NextRequest) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as CompleteBody;
  if (!body.contentId || !body.externalUrl) {
    return NextResponse.json({ error: 'contentId and externalUrl required' }, { status: 400 });
  }

  // 콘텐츠 존재 확인 (블로그 발행에 필요한 정보 포함)
  const content = await prisma.content.findUnique({
    where: { id: body.contentId },
    select: {
      id: true, ownerId: true, channel: true,
      topic: true, textBody: true, keywords: true,
      imageUrl: true, bodyImageUrls: true, scores: true,
    },
  });
  if (!content || content.channel !== 'blog') {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 });
  }

  // status → published
  await prisma.content.update({
    where: { id: body.contentId },
    data: { status: 'published' },
  });

  // ScheduleSlot 생성
  await prisma.scheduleSlot.create({
    data: {
      ownerId: content.ownerId,
      contentId: body.contentId,
      channel: 'blog',
      scheduledAt: new Date(),
      publishedAt: new Date(),
      status: 'published',
      mode: 'ai_auto',
      externalUrl: body.externalUrl,
    },
  });

  // --- 카페 동시 발행 (비동기, 실패해도 블로그 응답에 영향 없음) ---
  triggerCafePublish(content).catch((err) => {
    console.error('[blog-complete] 카페 동시 발행 실패:', err instanceof Error ? err.message : err);
  });

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// 카페 동시 발행: 블로그와 같은 토픽으로 카페에 자동 발행
// ---------------------------------------------------------------------------
async function triggerCafePublish(blogContent: {
  id: string;
  ownerId: string;
  topic: string;
  textBody: string | null;
  keywords: string[];
  imageUrl: string | null;
  bodyImageUrls: string[];
  scores: unknown;
}): Promise<void> {
  const { ownerId, topic, textBody } = blogContent;
  if (!textBody) return;

  // 카페 자격증명 확인
  const cafeCreds = await getNaverCafeCreds(ownerId);
  if (!cafeCreds) {
    console.log('[blog-complete] 카페 자격증명 없음 — 카페 발행 스킵');
    return;
  }

  // 중복 방지: 같은 토픽이 20시간 내 카페에 이미 발행됐으면 스킵
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const alreadyPublished = await prisma.scheduleSlot.findFirst({
    where: {
      ownerId,
      channel: 'naver_cafe',
      status: 'published',
      publishedAt: { gte: cutoff },
      content: { topic },
    },
  });
  if (alreadyPublished) {
    console.log(`[blog-complete] 카페 이미 발행됨 (${topic}) — 스킵`);
    return;
  }

  // 블로그 → 카페 변환
  console.log(`[blog-complete] 카페 변환 시작: ${topic}`);
  const converted = await convertBlogToChannel(textBody, topic, 'naver_cafe');

  // 카페용 Content 생성
  const cafeContent = await prisma.content.create({
    data: {
      ownerId,
      channel: 'naver_cafe',
      topic,
      tone: null,
      keywords: [],
      textBody: converted.text,
      imageUrl: blogContent.imageUrl,
      bodyImageUrls: blogContent.bodyImageUrls,
      scores: blogContent.scores as object ?? {},
      costKrw: converted.krw,
      status: 'draft',
    },
    select: { id: true },
  });

  // 변환 비용 기록
  await trackCost({
    ownerId,
    kind: 'chat',
    tokensIn: converted.usage.prompt_tokens,
    tokensOut: converted.usage.completion_tokens,
    krw: converted.krw,
    contentId: cafeContent.id,
  });

  // 카페 타겟 조회 → 순차 발행
  const cafeTargets = await getCafeTargets(ownerId);
  const targets = cafeTargets.length > 0
    ? cafeTargets
    : cafeCreds.clubId && cafeCreds.menuId
      ? [{ clubId: cafeCreds.clubId, menuId: cafeCreds.menuId, name: 'default' }]
      : [];

  if (targets.length === 0) {
    console.log('[blog-complete] 카페 타겟 없음 — 카페 발행 스킵');
    return;
  }

  const cafeSubject = converted.seoTitle ?? topic;
  const cafeKeywords = converted.seoTags ?? blogContent.keywords;

  for (let t = 0; t < targets.length; t++) {
    const target = targets[t];
    if (t > 0) await new Promise(r => setTimeout(r, 10_000)); // 스팸 방지 10초 대기

    try {
      const result = await publishNaverCafePost({
        subject: cafeSubject,
        content: converted.text,
        keywords: cafeKeywords,
        imageUrls: blogContent.bodyImageUrls,
        imageUrl: blogContent.imageUrl ?? undefined,
        clubId: target.clubId,
        menuId: target.menuId,
        ownerId,
      });

      console.log(`[blog-complete] 카페 ${target.name} 발행 성공: ${result.cafeUrl}`);

      // ScheduleSlot 생성
      await prisma.scheduleSlot.create({
        data: {
          ownerId,
          contentId: cafeContent.id,
          channel: 'naver_cafe',
          scheduledAt: new Date(),
          publishedAt: new Date(),
          status: 'published',
          mode: 'ai_auto',
          targetName: target.name,
          externalId: result.articleId,
          externalUrl: result.cafeUrl,
        },
      });
    } catch (err) {
      console.error(`[blog-complete] 카페 ${target.name} 발행 실패:`, err instanceof Error ? err.message : err);
    }
  }

  // Content status → published
  await prisma.content.update({
    where: { id: cafeContent.id },
    data: { status: 'published' },
  });

  console.log(`[blog-complete] 카페 동시 발행 완료: ${topic}`);
}
