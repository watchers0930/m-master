// POST → 예산체크 → RAG → GPT-4o (SSE stream) → 검수 → DB insert
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isBudgetExceeded } from '@/lib/cost/budget';
import { retrieveTopK, buildRagContext, hasIndexedDocs } from '@/lib/rag/retriever';
import {
  buildSystemPrompt,
  calcChatKrw,
  CLAUDE_MODEL,
  getClient,
  reviewContent,
  toChatUsage,
} from '@/lib/claude/chat';
import { translateImagePrompts, calcHaikuKrw } from '@/lib/claude/translate';
import { ensureMinimumMarkers, extractImagePrompts, searchMany } from '@/lib/unsplash/search';
import { calcEmbeddingKrw } from '@/lib/openai/embedding';
import { generateThumbnail, calcImageKrw } from '@/lib/openai/image';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { autoPublishToSocial } from '@/lib/publish/auto-publish';
import { buildExternalContext } from '@/lib/external/context-builder';
import { checkContentLimit, checkCostLimit } from '@/lib/billing/limits';
import type { ContentGenerateRequest } from '@/types/api';

const RequestSchema = z.object({
  topic: z.string().min(1).max(500),
  channel: z.enum(['blog', 'instagram', 'facebook', 'naver_cafe']),
  tone: z.string().max(100).optional(),
  keywords: z.array(z.string().max(50)).max(20).optional(),
  use_rag: z.boolean().optional(),
});

export const maxDuration = 60; // Hobby 플랜 최대 60초

const REVIEW_PASS_SCORE = 75;
const enc = new TextEncoder();
const sse = (obj: object) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: NextRequest) {
  // 1) 세션 검증
  const session = await requireSession();
  const ownerId = session.user.id;

  // 2) 요청 파싱
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('bad_request', 'JSON 파싱 실패', 400); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);

  const req: ContentGenerateRequest = parsed.data;

  // 3) 플랜 제한 체크
  const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
  try {
    await checkContentLimit(ownerId, user?.plan ?? 'free');
    await checkCostLimit(ownerId, user?.plan ?? 'free');
  } catch (limitErr) {
    return jsonError('plan_limit', limitErr instanceof Error ? limitErr.message : '플랜 한도 초과', 429);
  }

  // 3b) 예산 체크
  if (await isBudgetExceeded(ownerId)) return jsonError('budget_exceeded', '월 예산 한도 초과. 설정에서 한도를 조정하세요.', 429);

  // 4) settings (유저별)
  const settingsData = await prisma.setting.findUnique({
    where: { ownerId },
    select: { brandGuide: true, promptTemplates: true },
  });
  const brandGuide = (settingsData?.brandGuide ?? {}) as Record<string, unknown>;
  const channelTemplate = ((settingsData?.promptTemplates ?? {}) as Record<string, string>)[req.channel];

  // 5) RAG — 인덱싱된 문서가 있으면 자동 참조
  let ragContext = '';
  let embeddingTokens = 0;
  if (await hasIndexedDocs(ownerId)) {
    const ragQuery = [req.topic, ...(req.keywords ?? [])].join(' ');
    try {
      const { chunks, queryTokens } = await retrieveTopK({ query: ragQuery, ownerId, k: 5 });
      ragContext = buildRagContext(chunks);
      embeddingTokens = queryTokens;
    } catch (err) {
      console.warn('[generate] RAG 실패 (무시):', err);
    }
  }

  // 6) 외부 데이터 (뉴스 + MOLIT 시세)
  let externalContext = '';
  try {
    externalContext = await buildExternalContext(req.topic, req.keywords ?? []);
  } catch (err) {
    console.warn('[generate] 외부 데이터 실패 (무시):', err);
  }

  // 7) 프롬프트 조립
  const systemPrompt = buildSystemPrompt(req.channel, brandGuide, channelTemplate, req.tone);
  const currentYear = new Date().getFullYear();
  const userPrompt = [
    `주제: ${req.topic}`,
    req.keywords?.length ? `키워드: ${req.keywords.join(', ')}` : '',
    ragContext,
    externalContext,
    `${req.channel} 채널에 최적화된 마케팅 콘텐츠를 ${currentYear}년 기준으로 작성해주세요. 법령·세율·정책은 ${currentYear}년 최신 기준을 반영하고, 구체적 수치·사례·실무 인사이트를 포함하여 전문가 칼럼 수준의 깊이 있는 글을 작성하세요.`,
  ].filter(Boolean).join('\n\n');

  // SSE 스트리밍 응답
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(sse(obj));

      try {
        const client = getClient();
        let text = '';

        // 8) GPT-4o 스트리밍 생성
        const openaiStream = await client.chat.completions.create({
          model: CLAUDE_MODEL,
          max_tokens: 10000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
          stream_options: { include_usage: true },
        });

        let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

        for await (const chunk of openaiStream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            text += delta;
            send({ type: 'delta', text: delta });
          }
          if (chunk.usage) {
            streamUsage = chunk.usage;
          }
        }

        const usage = toChatUsage(streamUsage);
        const chatKrw = calcChatKrw(usage);

        // 본문 마커 폴백을 먼저 적용 (이후 작업들이 갱신된 text를 참조)
        text = ensureMinimumMarkers(text, 5);

        // 9~10) 검수 + 썸네일 + 본문 이미지 → 병렬 실행 (가장 큰 속도 개선)
        const t0 = Date.now();
        const [reviewSettled, thumbSettled, bodyImgsSettled] = await Promise.allSettled([
          // 검수
          reviewContent(text, req.channel),
          // 썸네일 (DALL-E)
          generateThumbnail(req.topic).then((img) => ({ url: img.url, krw: calcImageKrw() })),
          // 본문 이미지 (GPT-4o-mini 번역 → Unsplash 일괄 병렬 검색)
          (async () => {
            const koreanPrompts = extractImagePrompts(text);
            console.log(`[generate] 본문 마커 ${koreanPrompts.length}개 추출`);
            if (koreanPrompts.length === 0) return { urls: [] as string[], krw: 0 };
            const { queries, usage: trUsage } = await translateImagePrompts(koreanPrompts);
            const krw = calcHaikuKrw(trUsage);
            const found = await searchMany(queries);
            return { urls: found.map((u) => u ?? ''), krw };
          })(),
        ]);
        console.log(`[generate] 후처리 병렬 ${Date.now() - t0}ms`);

        // 검수 결과 추출
        let scores = { seo: 0, readability: 0, brand: 0, legal: 0, avg: 0 };
        if (reviewSettled.status === 'fulfilled') {
          const r = reviewSettled.value;
          scores = { seo: r.seo, readability: r.readability, brand: r.brand, legal: r.legal, avg: r.avg };
        } else {
          console.warn('[generate] 검수 실패 (무시):', reviewSettled.reason);
        }

        // 썸네일 결과 추출
        let imageUrl: string | null = null;
        let imageKrw = 0;
        if (thumbSettled.status === 'fulfilled') {
          imageUrl = thumbSettled.value.url;
          imageKrw = thumbSettled.value.krw;
        } /* DALL-E 실패는 무시 */

        // 본문 이미지 결과 추출
        let bodyImageUrls: string[] = [];
        let translateKrw = 0;
        if (bodyImgsSettled.status === 'fulfilled') {
          bodyImageUrls = bodyImgsSettled.value.urls;
          translateKrw = bodyImgsSettled.value.krw;
        } else {
          console.warn('[generate] 본문 이미지 처리 실패 (무시):', bodyImgsSettled.reason);
        }

        // 11) 비용
        const embedKrw = calcEmbeddingKrw(embeddingTokens);
        const totalKrw = chatKrw + embedKrw + imageKrw + translateKrw;

        // 12) DB insert
        const contentData = await prisma.content.create({
          data: {
            ownerId,
            channel: req.channel,
            topic: req.topic,
            tone: req.tone ?? null,
            keywords: req.keywords ?? [],
            textBody: text,
            imageUrl,
            bodyImageUrls,
            scores,
            costKrw: totalKrw,
            status: 'draft',
          },
          select: { id: true },
        });

        // 13) cost_ledger
        await trackCost({ ownerId, kind: 'chat', tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens, krw: chatKrw, contentId: contentData.id });
        if (embeddingTokens > 0) await trackCost({ ownerId, kind: 'embedding', tokensIn: embeddingTokens, tokensOut: 0, krw: embedKrw, contentId: contentData.id });
        if (imageKrw > 0) await trackCost({ ownerId, kind: 'image', tokensIn: 0, tokensOut: 0, krw: imageKrw, contentId: contentData.id });
        if (externalContext) await trackCost({ ownerId, kind: 'external', tokensIn: 0, tokensOut: 0, krw: 0, contentId: contentData.id });

        // 14) audit_log
        await logAudit({
          actor: ownerId,
          action: AUDIT_ACTIONS.CONTENT_GENERATE,
          targetType: 'content',
          targetId: contentData.id,
          payload: { channel: req.channel, topic: req.topic, scores, cost_krw: totalKrw, passed_review: scores.avg >= REVIEW_PASS_SCORE },
        });

        send({ type: 'done', data: { id: contentData.id, text, image_url: imageUrl, body_image_urls: bodyImageUrls, scores, cost_krw: totalKrw } });

        // 블로그 채널일 때 인스타/페북 자동 발행
        if (req.channel === 'blog') {
          await autoPublishToSocial({
            blogContentId: contentData.id,
            ownerId,
            blogText: text,
            topic: req.topic,
            imageUrl,
            bodyImageUrls,
            blogScores: scores,
            onProgress: (evt) => send(evt),
          });
        }

      } catch (err) {
        console.error('[generate] 스트리밍 오류:', err);
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
