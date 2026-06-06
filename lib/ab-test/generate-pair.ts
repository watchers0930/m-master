// lib/ab-test/generate-pair.ts — A/B 변형 동시 생성 + 롤백
// GPT-4o 비스트리밍 호출

import {
  buildSystemPrompt,
  calcChatKrw,
  CLAUDE_MODEL,
  getClient,
  reviewContent,
  toChatUsage,
  type ChatUsage,
} from '@/lib/claude/chat';
import { calcHaikuKrw, translateImagePrompts } from '@/lib/claude/translate';
import { extractImagePrompts, searchMany } from '@/lib/unsplash/search';
import { calcEmbeddingKrw } from '@/lib/openai/embedding';
import { calcImageKrw, generateThumbnail } from '@/lib/openai/image';
import { buildRagContext, retrieveTopK, hasIndexedDocs } from '@/lib/rag/retriever';
import { trackCost } from '@/lib/cost/tracker';
import { prisma } from '@/lib/prisma';
import type {
  Channel,
  ContentScores,
} from '@/types/db';
import { getVariantSeed, type AbVariantKey } from './prompts';

export interface GeneratePairOptions {
  ownerId: string;
  topic: string;
  channel: Channel;
  tone?: string | null;
  keywords?: string[];
}

export interface VariantGenerated {
  contentId: string;
  textBody: string;
  imageUrl: string | null;
  scores: ContentScores;
  costKrw: number;
}

const EMPTY_SCORES: ContentScores = {
  seo: 0,
  readability: 0,
  brand: 0,
  legal: 0,
  avg: 0,
};

interface SettingsLite {
  brand_guide: Record<string, unknown>;
  prompt_templates: Record<string, string>;
}

async function loadSettings(ownerId: string): Promise<SettingsLite> {
  const settings = await prisma.setting.findUnique({
    where: { ownerId },
    select: { brandGuide: true, promptTemplates: true },
  });
  return {
    brand_guide: (settings?.brandGuide ?? {}) as Record<string, unknown>,
    prompt_templates: (settings?.promptTemplates ?? {}) as Record<string, string>,
  };
}

async function buildRag(opts: GeneratePairOptions): Promise<{ ragContext: string; embeddingTokens: number }> {
  if (!(await hasIndexedDocs(opts.ownerId))) return { ragContext: '', embeddingTokens: 0 };
  const ragQuery = [opts.topic, ...(opts.keywords ?? [])].join(' ');
  try {
    const chunks = await retrieveTopK({ query: ragQuery, ownerId: opts.ownerId, k: 5 });
    return {
      ragContext: buildRagContext(chunks),
      embeddingTokens: Math.ceil(ragQuery.length / 3),
    };
  } catch (err) {
    console.warn('[ab-test/generate-pair] RAG 실패 (무시):', err);
    return { ragContext: '', embeddingTokens: 0 };
  }
}

async function generateOneVariant(
  variantKey: AbVariantKey,
  opts: GeneratePairOptions,
  settings: SettingsLite,
  ragContext: string,
  embeddingTokens: number,
): Promise<VariantGenerated> {
  const seed = getVariantSeed(variantKey);
  const channelTemplate = settings.prompt_templates[opts.channel];
  const systemPromptBase = buildSystemPrompt(
    opts.channel,
    settings.brand_guide,
    channelTemplate,
    opts.tone ?? undefined,
  );
  // 변형 지시는 시스템 프롬프트 끝에 append
  const systemPrompt = `${systemPromptBase}\n\n---\n${seed.directive}`;

  const userPrompt = [
    `주제: ${opts.topic}`,
    opts.keywords?.length ? `키워드: ${opts.keywords.join(', ')}` : '',
    ragContext,
    `${opts.channel} 채널에 최적화된 마케팅 콘텐츠를 작성해주세요.`,
    `(본 콘텐츠는 A/B 테스트 변형 ${variantKey.toUpperCase()}입니다 — 위 변형 지시를 반드시 준수)`,
  ].filter(Boolean).join('\n\n');

  // 1) GPT-4o 비스트리밍 호출
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: CLAUDE_MODEL,
    max_tokens: 5000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? '';
  if (!text) throw new Error(`variant ${variantKey} 텍스트 빈 응답`);

  const usage: ChatUsage = toChatUsage(completion.usage);
  const chatKrw = calcChatKrw(usage);

  // 2~3) 검수 + 썸네일 + 본문 이미지 병렬 실행
  const [reviewSettled, thumbSettled, bodyImgsSettled] = await Promise.allSettled([
    reviewContent(text, opts.channel),
    generateThumbnail(opts.topic).then((img) => ({ url: img.url, krw: calcImageKrw() })),
    (async () => {
      const koreanPrompts = extractImagePrompts(text);
      if (koreanPrompts.length === 0) return { urls: [] as string[], krw: 0 };
      const { queries, usage: trUsage } = await translateImagePrompts(koreanPrompts);
      const krw = calcHaikuKrw(trUsage);
      const found = await searchMany(queries);
      return { urls: found.map((u) => u ?? ''), krw };
    })(),
  ]);

  let scores: ContentScores = EMPTY_SCORES;
  if (reviewSettled.status === 'fulfilled') {
    const r = reviewSettled.value;
    scores = { seo: r.seo, readability: r.readability, brand: r.brand, legal: r.legal, avg: r.avg };
  } else {
    console.warn(`[ab-test/generate-pair] variant ${variantKey} 검수 실패 (무시):`, reviewSettled.reason);
  }

  let imageUrl: string | null = null;
  let imageKrw = 0;
  if (thumbSettled.status === 'fulfilled') {
    imageUrl = thumbSettled.value.url;
    imageKrw = thumbSettled.value.krw;
  } /* DALL-E 실패 무시 */

  let bodyImageUrls: string[] = [];
  let translateKrw = 0;
  if (bodyImgsSettled.status === 'fulfilled') {
    bodyImageUrls = bodyImgsSettled.value.urls;
    translateKrw = bodyImgsSettled.value.krw;
  } else {
    console.warn(`[ab-test/generate-pair] variant ${variantKey} 본문 이미지 처리 실패 (무시):`, bodyImgsSettled.reason);
  }

  // 4) embedding 비용은 RAG 호출 시 페어 단위로 계산되므로 변형별 0으로 두고
  //    호출부에서 1회만 trackCost하도록 분리. 단순화 위해 변형별 0/0 유지.
  const totalKrw = chatKrw + imageKrw + translateKrw;

  // 5) contents insert (prisma — owner_id 명시)
  const contentData = await prisma.content.create({
    data: {
      ownerId: opts.ownerId,
      channel: opts.channel,
      topic: opts.topic,
      tone: opts.tone ?? null,
      keywords: opts.keywords ?? [],
      textBody: text,
      imageUrl: imageUrl,
      bodyImageUrls: bodyImageUrls,
      scores,
      costKrw: totalKrw,
      status: 'draft',
    },
    select: { id: true },
  });

  // 6) cost_ledger (변형별 chat/image)
  await trackCost({
    ownerId: opts.ownerId,
    kind: 'chat',
    tokensIn: usage.prompt_tokens,
    tokensOut: usage.completion_tokens,
    krw: chatKrw,
    contentId: contentData.id,
  });
  if (imageKrw > 0) {
    await trackCost({
      ownerId: opts.ownerId,
      kind: 'image',
      tokensIn: 0,
      tokensOut: 0,
      krw: imageKrw,
      contentId: contentData.id,
    });
  }
  // 임베딩은 페어 단위로 한 번만 (호출부 처리 대신 첫 변형에 귀속)
  if (variantKey === 'a' && embeddingTokens > 0) {
    const embedKrw = calcEmbeddingKrw(embeddingTokens);
    if (embedKrw > 0) {
      await trackCost({
        ownerId: opts.ownerId,
        kind: 'embedding',
        tokensIn: embeddingTokens,
        tokensOut: 0,
        krw: embedKrw,
        contentId: contentData.id,
      });
    }
  }

  return {
    contentId: contentData.id,
    textBody: text,
    imageUrl,
    scores,
    costKrw: totalKrw,
  };
}

export class GenerateFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerateFailedError';
  }
}

// ----------------------------------------------------------------
// 단일 → AB 승격: source 콘텐츠 + 신규 변형 B 1개 생성
// ----------------------------------------------------------------
export interface GenerateVariantBOptions {
  ownerId: string;
  topic: string;
  channel: Channel;
  tone?: string | null;
  keywords?: string[];
}

export async function generateVariantBFromSource(
  options: GenerateVariantBOptions,
): Promise<VariantGenerated> {
  const settings = await loadSettings(options.ownerId);
  const { ragContext, embeddingTokens } = await buildRag(options);
  try {
    return await generateOneVariant('b', options, settings, ragContext, embeddingTokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GenerateFailedError(`variant b 실패: ${msg}`);
  }
}
