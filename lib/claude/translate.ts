// lib/claude/translate.ts — 한국어 이미지 설명 → 영어 Unsplash 검색 쿼리 일괄 변환
// Claude Haiku 4.5 사용 — 글당 ~10원
import type Anthropic from '@anthropic-ai/sdk';
import { getClient, toChatUsage, calcChatKrw, type ChatUsage } from './chat';

const HAIKU_MODEL = 'claude-haiku-4-5';

// Haiku 4.5 단가 (per 1M tokens, 환율 1400)
// input $1 / output $5 / cache-write $1.25 / cache-read $0.10
export function calcHaikuKrw(usage: ChatUsage): number {
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const regularInput = Math.max(0, usage.prompt_tokens - cacheCreate - cacheRead);

  const inputUsd = (regularInput / 1_000_000) * 1;
  const cacheCreateUsd = (cacheCreate / 1_000_000) * 1.25;
  const cacheReadUsd = (cacheRead / 1_000_000) * 0.10;
  const outputUsd = (usage.completion_tokens / 1_000_000) * 5;

  return Math.ceil((inputUsd + cacheCreateUsd + cacheReadUsd + outputUsd) * 1400);
}

export interface TranslateResult {
  queries: string[];
  usage: ChatUsage;
}

// 입력: 한국어 이미지 설명 배열
// 출력: 영어 검색 쿼리 배열 (Unsplash 매칭 최적화)
// 실패 시 원본 한국어 그대로 반환
export async function translateImagePrompts(
  koreanPrompts: string[],
): Promise<TranslateResult> {
  if (koreanPrompts.length === 0) {
    return { queries: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
  }

  const client = getClient();

  const systemPrompt = `당신은 한국어 이미지 설명을 영어 스톡 사진 검색 키워드로 변환하는 전문가입니다.

규칙:
1. 각 설명을 Unsplash에서 잘 매칭될 영어 키워드 2~4개로 변환
2. 추상적 개념(예: "인포그래픽", "흐름도")은 시각적 키워드로 치환 ("infographic" → "office desk meeting" 등 실제 사진 가능한 표현)
3. 한국 특수 법률 용어는 보편적 시각 키워드로 변환 ("등기" → "document signing", "법인설립" → "business startup")
4. 키워드는 공백으로 구분된 단어들로만 (문장 X)
5. 입력 배열 순서대로 동일 개수의 결과 배열을 반환

submit_translations 도구를 반드시 호출하여 결과를 제출하세요.`;

  const userPrompt = [
    '다음 한국어 이미지 설명들을 영어 Unsplash 검색 쿼리로 변환하세요:',
    '',
    ...koreanPrompts.map((p, i) => `${i + 1}. ${p}`),
  ].join('\n');

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{
      name: 'submit_translations',
      description: '영어 검색 쿼리 배열을 제출합니다 (입력 순서와 동일 길이)',
      input_schema: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: '각 입력 설명에 대응하는 영어 검색 쿼리',
          },
        },
        required: ['queries'],
      },
    }],
    tool_choice: { type: 'tool', name: 'submit_translations' },
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );

  let queries: string[];
  if (!toolUse) {
    console.warn('[translate] tool_use 응답 없음 — 한국어 원본 사용');
    queries = koreanPrompts;
  } else {
    const parsed = toolUse.input as { queries?: unknown };
    const arr = Array.isArray(parsed.queries) ? parsed.queries : [];
    // 길이 보정: 부족하면 원본으로 채우고, 초과하면 자름
    queries = koreanPrompts.map((orig, i) => {
      const q = arr[i];
      return typeof q === 'string' && q.trim() ? q.trim() : orig;
    });
  }

  return { queries, usage: toChatUsage(response.usage) };
}

// 비용 계산 export (호출부에서 사용)
export { calcChatKrw as calcSonnetKrw };
