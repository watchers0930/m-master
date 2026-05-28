// lib/topics/recommend.ts — GPT-4o tool_use 추천기 (TOP5 선정)
// 후보 15~20개 -> score(0~100) + tags(s/e/t) + reason 부여

import { z } from 'zod';
import { CLAUDE_MODEL, getClient, toChatUsage, type ChatUsage } from '@/lib/claude/chat';
import type { Candidate } from './candidates';

export type TagType = 's' | 'e' | 't'; // s=시즌, e=SEO/경쟁도, t=트렌드

export interface TopicTag {
  label: string;
  type: TagType;
}

export interface RecommendedTopic {
  rank: number; // 1~5
  topic: string; // 80자 이내
  score: number; // 0~100
  tags: TopicTag[]; // 최대 3개
  reason: string; // 60자 이내
}

export interface RecommendInput {
  monthYmd: string;
  candidates: Candidate[];
  channel: 'blog';
}

export interface RecommendResult {
  items: RecommendedTopic[];
  usage: ChatUsage;
}

// ----------------------------------------------------------------
// zod 검증 스키마 (서버 최종 검증)
// ----------------------------------------------------------------

const TagSchema = z.object({
  label: z.string().min(1).max(20),
  type: z.enum(['s', 'e', 't']),
});

const ItemSchema = z.object({
  rank: z.number().int().min(1).max(5),
  topic: z.string().min(1).max(80),
  score: z.number().min(0).max(100),
  tags: z.array(TagSchema).max(3),
  reason: z.string().min(1).max(60),
});

const ResponseSchema = z.object({
  items: z.array(ItemSchema),
});

// ----------------------------------------------------------------
// 시스템 프롬프트
// ----------------------------------------------------------------

function buildSystemPrompt(monthYmd: string): string {
  const month = parseInt(monthYmd.slice(5, 7), 10);
  return `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 콘텐츠 전략가입니다.
이번 주는 ${monthYmd} 주차 (${month}월)이며, 채널은 네이버 블로그입니다.
월~금 5일간 매일 1건씩 발행할 토픽을 선정합니다.

[VESTRA 도메인]
- 권리분석: AI 등기부등본 분석 / 근저당·가압류·소유권 확인 / 전세사기 예방
- 시세분석: 실거래가 조회 / 시세 전망 / 학군·역세권 분석 / 동네 비교
- 전세 안전: 전세보증보험 / 임대차 3법 / 보증금 안전 진단
- 부동산 세금: 취득세·양도세·종부세 계산

[작업]
주어진 후보 토픽 중 이번 주 블로그 발행에 가장 적합한 TOP 5를 선정하고,
각 항목에 score(0~100), tags(최대 3개), reason(60자 이내)을 부여합니다.

[score 기준]
- 90+: 시즌 적중 + 검색량 高 + 경쟁도 中低 (강력 추천)
- 80~89: 시즌·검색량·경쟁도 중 2가지 우수
- 70~79: 1가지 우수
- 70 미만은 가급적 추천하지 않음

[tags 사용 규칙]
- type 's' = 시즌 관련 (예: "5월 시즌", "결산 시즌")
- type 'e' = SEO/경쟁도/효율 (예: "SEO 고점수", "경쟁도 낮음")
- type 't' = 트렌드/검색량 (예: "검색량↑", "트렌드↑")
- label은 8자 이내 한국어 권장, 항목당 최대 3개

[도메인 다양성 — 반드시 준수]
- 5개 토픽은 반드시 서로 다른 도메인에서 선정 (같은 도메인 2개 이상 금지)
- 도메인 분류: 권리분석 / 시세·전망 / 전세·임대 / 세금·절세 / 동네정보·비교
- 5개 도메인 중 최소 4개 이상 커버해야 함

[제약]
- topic은 후보 목록의 표현을 그대로 사용하거나 80자 이내로 다듬을 수 있음
- reason은 60자 이내, 왜 이번 주 추천인지 1문장
- 5개 정확히 선정 (rank 1~5, score 내림차순 정렬)`;
}

// ----------------------------------------------------------------
// 후처리: score 클램프, topic 80자, tags 3개 슬라이스
// ----------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sanitize(items: RecommendedTopic[]): RecommendedTopic[] {
  const sorted = [...items]
    .map(it => ({
      rank: clamp(Math.floor(it.rank), 1, 5),
      topic: it.topic.slice(0, 80),
      score: clamp(it.score, 0, 100),
      tags: (it.tags ?? []).slice(0, 3).map(t => ({
        label: String(t.label ?? '').slice(0, 20),
        type: (['s', 'e', 't'] as const).includes(t.type) ? t.type : 'e',
      })),
      reason: String(it.reason ?? '').slice(0, 60),
    }))
    .sort((a, b) => b.score - a.score);

  // rank를 score 정렬 결과에 맞게 재부여
  return sorted.slice(0, 5).map((it, idx) => ({ ...it, rank: idx + 1 }));
}

// 부족 시 후보 weight 상위에서 채움
function fillFromCandidates(
  items: RecommendedTopic[],
  candidates: Candidate[],
): RecommendedTopic[] {
  if (items.length >= 5) return items.slice(0, 5);
  const used = new Set(items.map(i => i.topic));
  const sortedCands = [...candidates].sort((a, b) => b.weight - a.weight);
  const filled = [...items];
  for (const c of sortedCands) {
    if (filled.length >= 5) break;
    if (used.has(c.topic)) continue;
    used.add(c.topic);
    filled.push({
      rank: filled.length + 1,
      topic: c.topic.slice(0, 80),
      score: 60 + c.weight, // 보정 점수
      tags: [{ label: c.signal === 'season' ? '시즌' : c.signal === 'ga4_popular' ? '검색량↑' : '코어', type: c.signal === 'season' ? 's' : c.signal === 'ga4_popular' ? 't' : 'e' }],
      reason: '후보 가중치 기반 자동 보정',
    });
  }
  return filled.slice(0, 5).map((it, idx) => ({ ...it, rank: idx + 1 }));
}

// ----------------------------------------------------------------
// recommendTopFive
// ----------------------------------------------------------------

export async function recommendTopFive(input: RecommendInput): Promise<RecommendResult> {
  const client = getClient();
  const systemPrompt = buildSystemPrompt(input.monthYmd);

  const userPrompt = [
    `후보 목록 (${input.candidates.length}개):`,
    ...input.candidates.map((c, i) =>
      `${i + 1}. [${c.signal}/w${c.weight}] ${c.topic}`,
    ),
    '',
    '위 후보에서 TOP 5를 선정하여 submit_recommendations를 호출하세요.',
  ].join('\n');

  const response = await client.chat.completions.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'submit_recommendations',
        description: '이번 주 블로그 추천 토픽 TOP 5를 제출합니다',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rank: { type: 'integer', minimum: 1, maximum: 5 },
                  topic: { type: 'string', maxLength: 80 },
                  score: { type: 'number', minimum: 0, maximum: 100 },
                  tags: {
                    type: 'array',
                    maxItems: 3,
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        type: { type: 'string', enum: ['s', 'e', 't'] },
                      },
                      required: ['label', 'type'],
                    },
                  },
                  reason: { type: 'string', maxLength: 60 },
                },
                required: ['rank', 'topic', 'score', 'tags', 'reason'],
              },
            },
          },
          required: ['items'],
        },
      },
    }],
    tool_choice: { type: 'function', function: { name: 'submit_recommendations' } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    throw new Error('추천 function call 응답 없음');
  }

  const parsedRaw: unknown = JSON.parse(toolCall.function.arguments);

  // zod 검증 — 실패 시 부분만 통과시키고 후처리에서 보정
  const safe = ResponseSchema.safeParse(parsedRaw);
  let items: RecommendedTopic[] = [];
  if (safe.success) {
    items = safe.data.items;
  } else {
    // 실패 시 raw에서 가능한 항목만 추출
    const rawObj = parsedRaw as { items?: unknown[] };
    const rawItems = Array.isArray(rawObj?.items) ? rawObj.items : [];
    for (const ri of rawItems) {
      const it = ItemSchema.safeParse(ri);
      if (it.success) items.push(it.data);
    }
  }

  items = sanitize(items);
  items = fillFromCandidates(items, input.candidates);

  const usage: ChatUsage = toChatUsage(response.usage);

  return { items, usage };
}
