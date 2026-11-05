import { persistGeneratedContent, recordGenerationCosts } from '@/lib/content/persist-generated';
// POST /api/content/[id]/convert
// 블로그 콘텐츠를 인스타/페이스북 형식으로 변환 + 새 contents row insert
import { z } from 'zod';
import { VisibilityError, parseBody } from '@/lib/visibility/http';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isBudgetExceeded } from '@/lib/cost/budget';
import { checkContentLimit, checkCostLimit, getUserPlan } from '@/lib/billing/limits';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { generateInstagramCard, type CardData } from '@/lib/imagen/instagram-card';
import { upload, getPublicUrl } from '@/lib/storage';
import { randomUUID } from 'node:crypto';
import { derivedOrigin } from '@/lib/content/writer';

const RequestSchema = z.object({
  channel: z.enum(['instagram', 'facebook', 'naver_cafe']),
}).strict();

const fail = (code: string, message: string, status: number): never => { throw new VisibilityError(code, message, status); };

/** Returns the converted row summary; failures throw VisibilityError (the route shapes HTTP). */
export async function convertContent(ownerId: string, id: string, body: unknown) {
  const { channel } = parseBody(RequestSchema, body);

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
      origin: true,
      reviewStatus: true,
    },
  });

  if (!source) return fail('not_found', '원본 콘텐츠를 찾을 수 없습니다', 404);
  if (source.channel !== 'blog') return fail('invalid_state', '블로그 콘텐츠만 변환 가능합니다', 422);
  if (!source.textBody) return fail('invalid_state', '본문이 비어있습니다', 422);

  // 2) 플랜 제한 체크 (콘텐츠 수 + 비용 한도 + 유저 커스텀 예산)
  const plan = await getUserPlan(ownerId);
  try {
    await checkContentLimit(ownerId, plan);
    await checkCostLimit(ownerId, plan);
  } catch (err) {
    return fail('plan_limit', '플랜 한도 초과', 429);
  }
  if (await isBudgetExceeded(ownerId)) {
    return fail('budget_exceeded', '월 예산 한도 초과', 429);
  }

  // 3) Claude 변환
  let convertResult;
  try {
    convertResult = await convertBlogToChannel(source.textBody, source.topic, channel);
  } catch (err) {
    console.error(`[convert/${channel}] Claude 호출 실패:`, err);
    return fail('convert_failed', '변환 실패. 다시 시도해주세요.', 502);
  }

  // 유료 응답 직후 원장 기록(카드 생성·persist 전에 죽어도 비용이 남는다). persist 시 자식 콘텐츠에 연결된다.
  const recordedCosts = await recordGenerationCosts(ownerId, [{ kind:'chat', tokensIn:convertResult.usage.prompt_tokens,
    tokensOut:convertResult.usage.completion_tokens, krw:convertResult.krw }]);

  // 4) 인스타그램 카드 이미지 파이프라인
  const bodyImageUrls: string[] = [];
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
        // 파일명은 변환 1회마다 고유(generation id). 원본 id만 쓰면 재변환이 이미 승인된 자식의 카드 이미지를 덮어쓴다.
        const generationId = randomUUID();
        for (let i = 0; i < totalCards; i++) {
          const cardData: CardData = {
            title: cards[i].title,
            body: cards[i].body,
            footnote: cards[i].footnote || '',
            cardIndex: i,
            totalCards,
          };
          const pngBuffer = await generateInstagramCard(cardData);
          const fileName = `${id}/${generationId}_card_${i}.png`;
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
  // 자동 생성(또는 미승인) 원본의 파생물은 auto(pending_review)로 남는다 — 변환으로 검토를 우회하지 못하게.
  const newRow = await persistGeneratedContent({ origin: derivedOrigin(source), parentContentId: id,
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
    }, recordedCosts, undefined,
      { action:'content.generate',payload:{ source_id:id,channel,cost_krw:convertResult.krw } });

  return {
    id: newRow.id,
    channel,
    text: convertResult.text,
    cost_krw: convertResult.krw,
  };
}
