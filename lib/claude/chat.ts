// lib/claude/chat.ts — GPT-4o 채팅 완성 래퍼 (서버 전용)
// Anthropic Sonnet → OpenAI GPT-4o 전환 (2026-05-27)
import OpenAI from 'openai';
import type { Channel } from '@/types/db';
import { getChannelPrompt, getReviewCriteria } from './channel-prompts';

export const CLAUDE_MODEL = 'gpt-4o'; // 변수명은 호환성을 위해 유지

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 환경변수 미설정');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

// ----------------------------------------------------------------
// 콘텐츠 생성용 시스템 프롬프트 빌더
// ----------------------------------------------------------------
export function buildSystemPrompt(
  channel: Channel,
  brandGuide: Record<string, unknown>,
  templateOverride?: string,
  userTone?: string,
): string {
  if (templateOverride) return templateOverride;
  return getChannelPrompt(channel, { brandGuide, userTone });
}

// ----------------------------------------------------------------
// 사용량 / 비용
// ----------------------------------------------------------------
export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
}

// OpenAI Usage → ChatUsage 매핑 헬퍼
export function toChatUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): ChatUsage {
  return {
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
  };
}

// GPT-4o 단가 (per 1M tokens, 환율 1400 가정)
// input $2.50 / output $10.00
export function calcChatKrw(usage: ChatUsage): number {
  const inputUsd = (usage.prompt_tokens / 1_000_000) * 2.5;
  const outputUsd = (usage.completion_tokens / 1_000_000) * 10;
  return Math.ceil((inputUsd + outputUsd) * 1400);
}

// ----------------------------------------------------------------
// AI 검수 (4축 점수) — OpenAI function calling
// ----------------------------------------------------------------
export interface ReviewScores {
  seo: number;
  readability: number;
  brand: number;
  legal: number;
  avg: number;
  suggestions: string[];
}

export async function reviewContent(
  text: string,
  channel: Channel,
): Promise<ReviewScores> {
  const client = getClient();
  const criteria = getReviewCriteria(channel);
  const currentYear = new Date().getFullYear();

  const systemPrompt = `당신은 콘텐츠 검수 전문가입니다.
아래 텍스트를 4가지 축으로 각 0~100점 평가하세요.

**채널: ${channel}**

채점 기준:
- seo(0~100): 핵심 키워드가 제목·첫 문단·결론에 포함됐는가 / 구조: ${criteria.structure} / 글자수 ${criteria.charRange} / ${criteria.imageCount} / ${criteria.extras}
- readability(0~100): 문단 길이 적절 / 가독성 도구(bullet·표·이모지) 활용 / 도입부 훅 존재 / 결론부 CTA 존재
- brand(0~100): VESTRA 언급 자연스러운가 / 핵심 메시지(AI권리분석·실시간시세·비대면·전세사기예방) 포함 / 금지어 미사용 / 과장 표현 없음
- legal(0~100): 부동산등기법·상법·민법 근거 반영 / 구체적 수치·법령 출처 명시 / 허위·과장 표현 없음

깊이 감점 기준 (seo·readability 점수에 반영):
- 사전적 정의만 나열하고 실무 인사이트가 없으면 -15점
- 구체적 수치·통계·금액 예시가 2개 미만이면 -10점
- "~하는 것이 좋습니다" 같은 근거 없는 권유만 반복하면 -10점
- 연도 표기가 없거나 현재 연도(${currentYear}년)가 아닌 과거 연도를 사용하면 -10점

submit_scores 함수를 반드시 호출하여 점수를 제출하세요.`;

  const response = await client.chat.completions.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `채널: ${channel}\n\n텍스트:\n${text}` },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'submit_scores',
        description: '콘텐츠 검수 점수를 제출합니다',
        parameters: {
          type: 'object',
          properties: {
            seo: { type: 'number', description: '0~100' },
            readability: { type: 'number', description: '0~100' },
            brand: { type: 'number', description: '0~100' },
            legal: { type: 'number', description: '0~100' },
            suggestions: { type: 'array', items: { type: 'string' } },
          },
          required: ['seo', 'readability', 'brand', 'legal', 'suggestions'],
        },
      },
    }],
    tool_choice: { type: 'function', function: { name: 'submit_scores' } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') throw new Error('검수 function call 응답 없음');

  const parsed = JSON.parse(toolCall.function.arguments) as {
    seo: number;
    readability: number;
    brand: number;
    legal: number;
    suggestions?: string[];
  };

  const avg = (parsed.seo + parsed.readability + parsed.brand + parsed.legal) / 4;

  return {
    seo: parsed.seo,
    readability: parsed.readability,
    brand: parsed.brand,
    legal: parsed.legal,
    avg: Math.round(avg * 10) / 10,
    suggestions: parsed.suggestions ?? [],
  };
}
