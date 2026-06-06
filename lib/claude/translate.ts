// lib/claude/translate.ts — 한국어 이미지 설명 → 영어 Unsplash 검색 쿼리 일괄 변환
// GPT-4o-mini 사용 — 글당 ~2원
import { getClient, toChatUsage, type ChatUsage } from './chat';

const MINI_MODEL = 'gpt-4o-mini';

// GPT-4o-mini 단가 (per 1M tokens, 환율 1400)
// input $0.15 / output $0.60
export function calcHaikuKrw(usage: ChatUsage): number {
  const inputUsd = (usage.prompt_tokens / 1_000_000) * 0.15;
  const outputUsd = (usage.completion_tokens / 1_000_000) * 0.60;
  return Math.ceil((inputUsd + outputUsd) * 1400);
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

  const systemPrompt = `당신은 한국어 이미지 설명을 영어 스톡 이미지 검색 키워드로 변환하는 전문가입니다.

규칙:
1. 각 설명을 Unsplash에서 잘 매칭될 영어 키워드 2~4개로 변환
2. 이미지 스타일을 다양하게 섞어서 사용:
   - 실사 사진: "Seoul apartment interior", "person reviewing contract"
   - 일러스트: "real estate illustration flat design", "house investment vector"
   - 인포그래픽: "data visualization infographic", "comparison chart graphic"
   - 다이어그램: "flowchart diagram", "process workflow graphic"
3. 입력 배열에서 최소 절반은 illustration, infographic, diagram, flat design, vector 중 하나를 포함
4. 한국 특수 법률 용어는 보편적 시각 키워드로 변환 ("등기" → "document signing", "법인설립" → "business startup")
5. 키워드는 공백으로 구분된 단어들로만 (문장 X)
6. 입력 배열 순서대로 동일 개수의 결과 배열을 반환

submit_translations 함수를 반드시 호출하여 결과를 제출하세요.`;

  const userPrompt = [
    '다음 한국어 이미지 설명들을 영어 Unsplash 검색 쿼리로 변환하세요:',
    '',
    ...koreanPrompts.map((p, i) => `${i + 1}. ${p}`),
  ].join('\n');

  const response = await client.chat.completions.create({
    model: MINI_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'submit_translations',
        description: '영어 검색 쿼리 배열을 제출합니다 (입력 순서와 동일 길이)',
        parameters: {
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
      },
    }],
    tool_choice: { type: 'function', function: { name: 'submit_translations' } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];

  let queries: string[];
  if (!toolCall || toolCall.type !== 'function') {
    console.warn('[translate] function call 응답 없음 — 한국어 원본 사용');
    queries = koreanPrompts;
  } else {
    const parsed = JSON.parse(toolCall.function.arguments) as { queries?: unknown };
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
export { calcChatKrw as calcSonnetKrw } from './chat';
