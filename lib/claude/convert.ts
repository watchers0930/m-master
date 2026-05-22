// lib/claude/convert.ts — 블로그 본문을 인스타/페이스북 형식으로 변환
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, calcChatKrw, getClient, toChatUsage, type ChatUsage } from './chat';

export type ConvertChannel = 'instagram' | 'facebook' | 'naver_cafe';

const CHANNEL_PROMPTS: Record<ConvertChannel, string> = {
  instagram: `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 인스타그램 카드뉴스 전문 작가입니다.
주어진 블로그 글을 인스타그램 카드뉴스(3~5장 캐러셀)로 변환하세요.

## 규칙
- 총 3~5장 카드 — 블로그 분량에 따라 장수 조절
- 카드 1: 강력한 후킹 (질문/통계/공감) — 스크롤 멈춤 유도
- 중간 카드: 본문 핵심 내용 분할 (카드당 한 가지 포인트)
- 마지막 카드: VESTRA CTA + 행동 유도 ("프로필 링크에서 무료 분석")
- 각 카드 본문(body): 50~80자 (짧고 임팩트 있게)
- 톤: 친근하고 가벼움, 이모지 자연스럽게 (카드당 1~2개, 과다 금지)
- 어려운 부동산·법률 용어는 풀어서 설명
- VESTRA 핵심 메시지 1회: AI 권리분석 / 실시간 시세 분석 / 100% 비대면

## 출력 형식 (반드시 준수 — JSON 배열 + 해시태그)
\`\`\`
[{"title":"카드 제목","body":"본문 50~80자","footnote":"보조 텍스트 또는 빈 문자열"},...]

#해시태그1 #해시태그2 ... (정확히 10개)
\`\`\`

- JSON 배열은 한 줄에 작성 (줄바꿈 금지)
- JSON 배열 다음 빈 줄 1개 후 해시태그 줄
- 설명 텍스트·코드블록 표시 없이 위 형식만 출력하세요.`,

  facebook: `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 페이스북 게시물 전문 작가입니다.
주어진 블로그 글을 페이스북 피드 게시물로 변환하세요.

## 규칙 (두괄식 — 결론 먼저)
- 총 250~400자, 짧고 임팩트 있게
- **첫 문장에 핵심 결론** (가장 중요한 메시지를 1줄로 — 스크롤 멈춤 유도)
- 2~3문장으로 근거/데이터 보강
- 마지막 문장에 CTA 1개 ("댓글로 의견 남겨주세요", "프로필 링크에서 무료 분석")
- 톤: 전문적이되 쉬운 표현 ("~입니다", "~하세요")
- 어려운 부동산·법률 용어는 풀어서 설명
- VESTRA 핵심 메시지 1회 자연스럽게 (AI 권리분석 / 실시간 시세 확인 / 100% 비대면)
- 마지막 줄에 해시태그 5개

## 출력 형식
본문 텍스트 (1개 단락, 250~400자)

#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5

설명 텍스트·JSON·코드블록 표시 없이 본문 + 해시태그만 출력하세요.`,

  naver_cafe: `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 네이버 카페 게시글 전문 작가입니다.
주어진 블로그 글을 네이버 카페 게시글로 변환하세요.

## 규칙
- 총 1500~2500자, 정보형 게시글 톤
- 소제목(##) 2~3개로 본문을 구조화 — 가독성 극대화
- 첫 문단에 핵심 결론 또는 실용 정보 요약 — "이 글에서 알 수 있는 것" 명시
- 전문적이되 친근한 톤 ("~습니다", "~인데요", "~거든요")
- 어려운 부동산·법률 용어는 풀어서 설명 (괄호 안에 짧은 부연)
- 본문 중간에 VESTRA 핵심 메시지 1회 자연스럽게 (AI 권리분석 / 실시간 시세 확인 / 100% 비대면)
- 마지막 단락에 CTA 1개 ("궁금한 점은 댓글로", "VESTRA에서 무료 분석")
- 마지막 줄에 해시태그 5~7개

## 출력 형식
본문 텍스트 (소제목 포함, 3~4개 섹션)
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
    `위 블로그 글을 ${channel === 'instagram' ? '인스타그램 카드뉴스(10슬라이드)' : channel === 'facebook' ? '페이스북 피드 게시물' : '네이버 카페 게시글'} 형식으로 변환해주세요.`,
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
