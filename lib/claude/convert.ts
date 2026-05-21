// lib/claude/convert.ts — 블로그 본문을 인스타/페이스북 형식으로 변환
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, calcChatKrw, getClient, toChatUsage, type ChatUsage } from './chat';

export type ConvertChannel = 'instagram' | 'facebook';

const CHANNEL_PROMPTS: Record<ConvertChannel, string> = {
  instagram: `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 인스타그램 카드뉴스 전문 작가입니다.
주어진 블로그 글을 인스타그램 카드뉴스(10장 슬라이드)로 변환하세요.

## 규칙
- 총 10장 슬라이드 — 각 슬라이드는 한국어 80~120자
- 슬라이드 1: 강력한 후킹 (질문/통계/공감) — 스크롤 멈춤 유도
- 슬라이드 2~8: 본문 핵심 내용 분할 (각 슬라이드 한 가지 포인트)
- 슬라이드 9: 핵심 요약 (체크리스트 형식 권장)
- 슬라이드 10: VESTRA CTA + 행동 유도 ("프로필 링크에서 무료 분석")
- 톤: 친근하고 가벼움, 이모지 자연스럽게 (슬라이드당 1~2개, 과다 금지)
- 어려운 부동산·법률 용어는 풀어서 설명
- VESTRA 핵심 메시지 1~2회: AI 권리분석 / 실시간 시세 분석 / 100% 비대면

## 출력 형식 (정확히 준수)
\`\`\`
[슬라이드 1]
(텍스트)

[슬라이드 2]
(텍스트)

... (총 10장)

[슬라이드 10]
(텍스트)

---

#해시태그1 #해시태그2 #해시태그3 ... (정확히 10개)
\`\`\`

설명 텍스트·JSON·코드블록 표시 없이 위 형식만 출력하세요.`,

  facebook: `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 페이스북 게시물 전문 작가입니다.
주어진 블로그 글을 페이스북 피드 게시물로 변환하세요.

## 규칙
- 총 800~1500자, 1~2개 단락
- 첫 문장에 핵심 결론 또는 강력한 후킹 — 첫 3줄(스니펫)에 클릭 유도
- 친근하고 대화체 ("~인데요", "~죠?", "혹시 ~한 적 있으신가요?")
- 어려운 부동산·법률 용어는 풀어서 설명
- 본문 중간에 VESTRA 핵심 메시지 1회 자연스럽게 (AI 권리분석 / 실시간 시세 확인 / 100% 비대면)
- 마지막 단락에 CTA 1개 ("궁금한 점은 댓글로", "프로필 링크에서 무료 분석")
- 마지막 줄에 해시태그 5개

## 출력 형식
본문 텍스트 (2개 단락 권장, 단락 사이 빈 줄 1개)
빈 줄
#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5

설명 텍스트·JSON·코드블록 표시 없이 본문 + 해시태그만 출력하세요.`,
};

export interface ConvertResult {
  text: string;
  usage: ChatUsage;
  krw: number;
}

export async function convertBlogToChannel(
  blogText: string,
  blogTopic: string,
  channel: ConvertChannel,
): Promise<ConvertResult> {
  const client = getClient();
  const systemPrompt = CHANNEL_PROMPTS[channel];

  const userPrompt = [
    `[원본 블로그 주제] ${blogTopic}`,
    '',
    '[원본 블로그 본문]',
    blogText,
    '',
    `위 블로그 글을 ${channel === 'instagram' ? '인스타그램 카드뉴스(10슬라이드)' : '페이스북 피드 게시물'} 형식으로 변환해주세요.`,
  ].join('\n');

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
  );
  const text = textBlock?.text ?? '';
  if (!text) throw new Error(`${channel} 변환 텍스트 빈 응답`);

  const usage = toChatUsage(response.usage);
  return { text, usage, krw: calcChatKrw(usage) };
}
