// lib/content/generate-headless.ts — SSE 없는 콘텐츠 생성 (cron·배치용)
// GPT-4o 비스트리밍 생성

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface HeadlessGenerateOptions {
  topic: string;
  channel: 'blog' | 'instagram' | 'facebook';
  ownerId: string;
  tone?: string;
  keywords?: string[];
}

export interface HeadlessGenerateResult {
  contentId: string;
  text: string;
  imageUrl: string | null;
  bodyImageUrls: string[];
  scores: Record<string, number> | null;
  costKrw: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function generateContentHeadless(
  opts: HeadlessGenerateOptions,
): Promise<HeadlessGenerateResult> {
  const { topic, channel, ownerId, tone, keywords = [] } = opts;

  // 1) 예산 체크
  if (await isBudgetExceeded()) {
    throw new Error('BUDGET_EXCEEDED: 월 예산 한도 초과');
  }

  // 2) settings
  const settingsData = await prisma.setting.findUnique({
    where: { id: 1 },
    select: { brandGuide: true, promptTemplates: true },
  });
  const brandGuide = (settingsData?.brandGuide ?? {}) as Record<string, unknown>;
  const channelTemplate = ((settingsData?.promptTemplates ?? {}) as Record<string, string>)[channel];

  // 3) RAG — 인덱싱된 문서가 있으면 자동 참조
  let ragContext = '';
  let embeddingTokens = 0;
  if (await hasIndexedDocs(ownerId)) {
    const ragQuery = [topic, ...keywords].join(' ');
    try {
      const chunks = await retrieveTopK({ query: ragQuery, ownerId, k: 5 });
      ragContext = buildRagContext(chunks);
      embeddingTokens = Math.ceil(ragQuery.length / 3);
    } catch (err) {
      console.warn('[generate-headless] RAG 실패 (무시):', err);
    }
  }

  // 4) 프롬프트 조립
  const systemPrompt = buildSystemPrompt(channel, brandGuide, channelTemplate, tone);
  const userPrompt = [
    `주제: ${topic}`,
    keywords.length ? `키워드: ${keywords.join(', ')}` : '',
    ragContext,
    `${channel} 채널에 최적화된 마케팅 콘텐츠를 작성해주세요.`,
  ].filter(Boolean).join('\n\n');

  // 5) GPT-4o — 비스트리밍 생성
  const client = getClient();
  const response = await client.chat.completions.create({
    model: CLAUDE_MODEL,
    max_tokens: 5000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  let text = response.choices[0]?.message?.content ?? '';

  const usage = toChatUsage(response.usage);
  const chatKrw = calcChatKrw(usage);

  // 본문 마커 폴백
  text = ensureMinimumMarkers(text, 5);

  // 6) 검수 + 썸네일 + 본문 이미지 → 병렬
  const [reviewSettled, thumbSettled, bodyImgsSettled] = await Promise.allSettled([
    reviewContent(text, channel),
    generateThumbnail(topic).then((img) => ({ url: img.url, krw: calcImageKrw() })),
    (async () => {
      const koreanPrompts = extractImagePrompts(text);
      if (koreanPrompts.length === 0) return { urls: [] as string[], krw: 0 };
      const { queries, usage: trUsage } = await translateImagePrompts(koreanPrompts);
      const krw = calcHaikuKrw(trUsage);
      const found = await searchMany(queries);
      return { urls: found.map((u) => u ?? ''), krw };
    })(),
  ]);

  // 검수 결과
  let scores = { seo: 0, readability: 0, brand: 0, legal: 0, avg: 0 };
  if (reviewSettled.status === 'fulfilled') {
    const r = reviewSettled.value;
    scores = { seo: r.seo, readability: r.readability, brand: r.brand, legal: r.legal, avg: r.avg };
  }

  // 썸네일
  let imageUrl: string | null = null;
  let imageKrw = 0;
  if (thumbSettled.status === 'fulfilled') {
    imageUrl = thumbSettled.value.url;
    imageKrw = thumbSettled.value.krw;
  }

  // 본문 이미지
  let bodyImageUrls: string[] = [];
  let translateKrw = 0;
  if (bodyImgsSettled.status === 'fulfilled') {
    bodyImageUrls = bodyImgsSettled.value.urls;
    translateKrw = bodyImgsSettled.value.krw;
  }

  // 7) 비용 집계
  const embedKrw = calcEmbeddingKrw(embeddingTokens);
  const totalKrw = chatKrw + embedKrw + imageKrw + translateKrw;

  // 8) DB insert
  const contentData = await prisma.content.create({
    data: {
      ownerId,
      channel,
      topic,
      tone: tone ?? null,
      keywords,
      textBody: text,
      imageUrl,
      bodyImageUrls,
      scores,
      costKrw: totalKrw,
      status: 'draft',
    },
    select: { id: true },
  });

  // 9) cost_ledger
  await trackCost({ kind: 'chat', tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens, krw: chatKrw, contentId: contentData.id });
  if (embeddingTokens > 0) await trackCost({ kind: 'embedding', tokensIn: embeddingTokens, tokensOut: 0, krw: embedKrw, contentId: contentData.id });
  if (imageKrw > 0) await trackCost({ kind: 'image', tokensIn: 0, tokensOut: 0, krw: imageKrw, contentId: contentData.id });

  return {
    contentId: contentData.id,
    text,
    imageUrl,
    bodyImageUrls,
    scores,
    costKrw: totalKrw,
  };
}
