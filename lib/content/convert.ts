import { persistGeneratedContent } from '@/lib/content/persist-generated';
// POST /api/content/[id]/convert
// 블로그 콘텐츠를 인스타/페이스북 형식으로 변환 + 새 contents row insert
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isBudgetExceeded } from '@/lib/cost/budget';
import { checkContentLimit, checkCostLimit, getUserPlan } from '@/lib/billing/limits';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { generateInstagramCard, type CardData } from '@/lib/imagen/instagram-card';
import { upload, getPublicUrl } from '@/lib/storage';

const RequestSchema = z.object({
  channel: z.enum(['instagram', 'facebook', 'naver_cafe']),
}).strict();

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { data: null, error: { code, message } },
    { status },
  );
}

export async function convertContent(ownerId: string, id: string, request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('bad_request', 'JSON 파싱 실패', 400); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);

  const { channel } = parsed.data;

  // 1) 원본 블로그 조회
  const source = await prisma.content.findFirst({
    where: { id, ownerId },
    select: {
      id: true,
      ownerId: true,
      channel: true,
      topic: true,
      tone: true,
      keywords: true,
      textBody: true,
      imageUrl: true,
      bodyImageUrls: true,
      scores: true,
    },
  });

  if (!source) return jsonError('not_found', '원본 콘텐츠를 찾을 수 없습니다', 404);
  if (source.channel !== 'blog') return jsonError('invalid_state', '블로그 콘텐츠만 변환 가능합니다', 422);
  if (!source.textBody) return jsonError('invalid_state', '본문이 비어있습니다', 422);

  // 2) 플랜 제한 체크 (콘텐츠 수 + 비용 한도 + 유저 커스텀 예산)
  const plan = await getUserPlan(ownerId);
  try {
    await checkContentLimit(ownerId, plan);
    await checkCostLimit(ownerId, plan);
  } catch (err) {
    return jsonError('plan_limit', '플랜 한도 초과', 429);
  }
  if (await isBudgetExceeded(ownerId)) {
    return jsonError('budget_exceeded', '월 예산 한도 초과', 429);
  }

  // 3) Claude 변환
  let convertResult;
  try {
    convertResult = await convertBlogToChannel(source.textBody, source.topic, channel);
  } catch (err) {
    console.error(`[convert/${channel}] Claude 호출 실패:`, err);
    return jsonError('convert_failed', '변환 실패. 다시 시도해주세요.', 502);
  }

  // 4) 인스타그램 카드 이미지 파이프라인
  let bodyImageUrls: string[] = [];
  let captionText = convertResult.text;

  if (channel === 'instagram') {
    try {
      // Claude 응답에서 JSON 배열 + 해시태그 분리
      const lines = convertResult.text.trim().split('\n');
      let jsonLine = '';
      const hashtagLines: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.includes('{')) {
          jsonLine = trimmed;
        } else if (trimmed.startsWith('#')) {
          hashtagLines.push(trimmed);
        }
      }

      if (jsonLine) {
        const cards = JSON.parse(jsonLine) as Array<{ title: string; body: string; footnote?: string }>;
        const totalCards = cards.length;

        // 각 카드 → PNG → storage 업로드
        for (let i = 0; i < totalCards; i++) {
          const cardData: CardData = {
            title: cards[i].title,
            body: cards[i].body,
            footnote: cards[i].footnote || '',
            cardIndex: i,
            totalCards,
          };
          const pngBuffer = await generateInstagramCard(cardData);
          const fileName = `${id}_card_${i}.png`;
          await upload('card-images', fileName, pngBuffer);
          bodyImageUrls.push(getPublicUrl('card-images', fileName));
        }

        // 캡션은 해시태그만 (카드에 본문이 들어가므로)
        captionText = hashtagLines.join('\n') || convertResult.text;
      }
    } catch (cardErr) {
      // 카드 생성 실패 시 원본 텍스트 유지, 이미지 없이 진행
      console.error('[convert/instagram] 카드 이미지 생성 실패:', cardErr);
    }
  }

  // 5) DB insert — 새 채널의 contents row
  const newRow = await persistGeneratedContent({ origin: 'manual', parentContentId: id,
      ownerId,
      channel,
      topic: source.topic,
      tone: source.tone,
      keywords: (source.keywords as string[]) ?? [],
      textBody: captionText,
      imageUrl: source.imageUrl,
      bodyImageUrls,
      scores: source.scores ?? Prisma.DbNull,
      costKrw: convertResult.krw,
      status: 'draft',
    }, [{ kind:'chat', tokensIn:convertResult.usage.prompt_tokens,
      tokensOut:convertResult.usage.completion_tokens, krw:convertResult.krw }], undefined,
      { action:'content.generate',payload:{ source_id:id,channel,cost_krw:convertResult.krw } });

  return NextResponse.json({
    data: {
      id: newRow.id,
      channel,
      text: convertResult.text,
      cost_krw: convertResult.krw,
    },
    error: null,
  });
}
