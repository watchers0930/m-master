// lib/claude/convert.ts — 블로그 본문을 인스타/페이스북 형식으로 변환
// OpenAI GPT-4o 사용
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

## 핵심 원칙
- 원본 블로그의 구조, 분량, 전문성을 그대로 유지
- "글 → [이미지] → 글 → [이미지]" 교차 단락 구조 유지
- 소제목, 목차, 단계별 설명 등 블로그 구조를 그대로 보존
- 원본 분량의 90% 이상 유지 (축약 금지)

## 네이버 검색 최적화 (필수)
- 제목: 핵심 키워드를 앞에 배치, 30~45자, 검색 의도에 맞는 구조 (예: "근저당 확인 방법 | 2026 하반기 부동산 시세 전망")
- 첫 문단(2~3문장): 핵심 키워드 2~3개를 자연스럽게 포함 — 네이버 검색 결과 스니펫으로 노출됨
- 소제목(##): 사람들이 실제 네이버에서 검색할 만한 질문·키워드 형태로 작성 (예: "전세보증보험 가입 조건은?", "근저당 설정이란 무엇인가")
- 본문: 최소 2000자 이상 유지 — 긴 글이 네이버 검색에서 유리
- 문단마다 핵심 키워드 자연스럽게 반복 (키워드 스터핑 금지, 읽기 자연스러워야 함)
- 태그: 사람들이 실제로 네이버에 입력하는 검색어 스타일 (단어가 아닌 구문, 예: "전세보증보험 가입방법", "근저당이란")

## 형식 규칙
- 마크다운 형식 사용: ## 소제목, **강조**, - 목록 항목
- [이미지: 설명] 플레이스홀더를 원본 위치 그대로 유지
- 톤: 전문적이면서 읽기 쉬운 ("~입니다", "~합니다")
- VESTRA 언급은 원본 그대로 유지
- 어려운 부동산·법률 용어는 풀어서 설명

## 네이버 카페 적응 (최소한의 변경만)
- 해시태그(#키워드) 사용 금지
- 외부 링크 삽입 금지
- 광고성 CTA는 자연스러운 마무리로 완화

## 출력 형식 (반드시 준수)
첫 줄: [제목] 검색 최적화된 카페 글 제목 (30~45자)
그 다음: 마크다운 형식의 본문 전체
마지막 줄: [태그] 실제검색어1, 실제검색어2, ... (10개, 네이버 검색어 스타일 롱테일 키워드)

설명·JSON·코드블록 없이 위 형식만 출력하세요.`,
};

export interface ConvertResult {
  text: string;
  seoTitle?: string;
  seoTags?: string[];
  usage: ChatUsage;
  krw: number;
}

/** naver_cafe 변환 출력에서 [제목], [태그], 본문을 분리 */
function parseCafeOutput(raw: string): { seoTitle?: string; seoTags?: string[]; body: string } {
  const lines = raw.split('\n');
  let seoTitle: string | undefined;
  let seoTags: string[] | undefined;
  let bodyStart = 0;
  let bodyEnd = lines.length;

  // 첫 줄: [제목] ...
  if (lines[0]?.trim().startsWith('[제목]')) {
    seoTitle = lines[0].trim().replace(/^\[제목\]\s*/, '').trim();
    bodyStart = 1;
    // 제목 다음 빈 줄 스킵
    while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  }

  // 마지막 비공백 줄: [태그] ...
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx--;
  if (lastIdx >= 0 && lines[lastIdx].trim().startsWith('[태그]')) {
    const tagLine = lines[lastIdx].trim().replace(/^\[태그\]\s*/, '');
    seoTags = tagLine.split(',').map(t => t.trim()).filter(t => t.length >= 2);
    bodyEnd = lastIdx;
    // 태그 직전 빈 줄 스킵
    while (bodyEnd > bodyStart && lines[bodyEnd - 1].trim() === '') bodyEnd--;
  }

  const body = lines.slice(bodyStart, bodyEnd).join('\n').trim();
  return { seoTitle: seoTitle || undefined, seoTags: seoTags?.length ? seoTags : undefined, body };
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

  const maxTokens = channel === 'naver_cafe' ? 4096 : 2500;

  const response = await client.chat.completions.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const rawText = response.choices[0]?.message?.content ?? '';
  if (!rawText) throw new Error(`${channel} 변환 텍스트 빈 응답`);

  const usage = toChatUsage(response.usage);
  const krw = calcChatKrw(usage);

  // naver_cafe: [제목]/[태그] 파싱
  if (channel === 'naver_cafe') {
    const parsed = parseCafeOutput(rawText);
    return { text: parsed.body || rawText, seoTitle: parsed.seoTitle, seoTags: parsed.seoTags, usage, krw };
  }

  return { text: rawText, usage, krw };
}
