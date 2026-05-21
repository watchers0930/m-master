// lib/openai/embedding.ts — text-embedding-3-small 임베딩 래퍼 (서버 전용)
// OPENAI_API_KEY 서버 전용. 클라이언트 번들 미노출.

import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 환경변수 미설정');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

// text-embedding-3-small: 1536 dim, $0.02/1M tokens
const EMBEDDING_MODEL = 'text-embedding-3-small';

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

// 단일 텍스트 임베딩
export async function embedText(text: string): Promise<EmbeddingResult> {
  const client = getClient();

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) throw new Error('임베딩 빈 응답');

  return {
    embedding,
    tokens: response.usage.prompt_tokens,
  };
}

// 배치 임베딩 (청크 배열 처리)
export async function embedTexts(
  texts: string[],
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const client = getClient();

  // OpenAI 배치 최대 2048 inputs — 실제로는 청킹 단계에서 충분히 작음
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  const tokensPerItem =
    texts.length > 0
      ? Math.ceil(response.usage.prompt_tokens / texts.length)
      : 0;

  return response.data.map((item, idx) => ({
    embedding: item.embedding,
    tokens: tokensPerItem,
    // 실제 per-item 토큰은 API 비제공 — 총합을 균등 분배
    _index: idx, // 내부용
  }));
}

// ----------------------------------------------------------------
// KRW 비용 계산 (text-embedding-3-small: $0.02/1M tokens, 환율 1400)
// ----------------------------------------------------------------
export function calcEmbeddingKrw(tokens: number): number {
  const usd = (tokens / 1_000_000) * 0.02;
  return Math.ceil(usd * 1400);
}
