// lib/claude/chat.ts — GPT-4o 채팅 완성 래퍼 (서버 전용)
// Anthropic Sonnet → OpenAI GPT-4o 전환 (2026-05-27)
import OpenAI from 'openai';
import type { Channel } from '@/types/db';

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
const TONE_GUIDE: Record<string, string> = {
  '전문적': `- 문체: 격식체(~입니다/~습니다), 능동문 위주, 감탄사·이모지 금지
- 어휘: 법률·등기 전문 용어 활용, 약어는 첫 등장 시 풀어쓰기
- 구조: 근거(법령·수치) → 설명 → 결론 순서로 전개
- 금지: 구어체, 반말, 감성적 표현, 과장 수식어`,

  '친근한': `- 문체: 대화체(~요/~죠), 독자에게 직접 말 걸기("여러분", "혹시 이런 경험 있으신가요?")
- 어휘: 쉬운 일상어, 어려운 법률 용어는 괄호로 설명 병기
- 구조: 공감 → 문제 → 해결책 순서로 전개, 짧은 문단
- 금지: 딱딱한 격식체, 법령 조항 나열`,

  '정보제공': `- 문체: 중립적 설명체, 주관 표현 최소화
- 어휘: 사실 중심, 수치·출처 명시, 비교·대조 구조 선호
- 구조: 정의 → 절차 → 비용 → FAQ 순서, 표·bullet 적극 활용
- 금지: 주관적 평가, 감성 표현, 브랜드 자랑`,

  '설득적': `- 문체: 행동 촉구형("지금 바로", "놓치지 마세요"), 혜택 강조
- 어휘: 이점·절약·편의 키워드 반복, 사회적 증거(수치·사례) 인용
- 구조: 문제 제기 → 고통 공감 → 해결책(VESTRA) → CTA 강화
- 금지: 소극적 표현("~할 수도 있습니다"), 단점 언급`,
};

export function buildSystemPrompt(
  channel: Channel,
  brandGuide: Record<string, unknown>,
  templateOverride?: string,
  userTone?: string,
): string {
  const toneKey = userTone ?? (brandGuide.tone as string) ?? '전문적';
  const toneGuide = TONE_GUIDE[toneKey] ?? TONE_GUIDE['전문적'];
  const forbidden = (brandGuide.forbidden_words as string[] | undefined)
    ?.join(', ') ?? '';

  const currentYear = new Date().getFullYear();

  const base = templateOverride ??
    `당신은 VESTRA(AI 기반 부동산 권리분석·시세분석 서비스) 전문 마케팅 작가입니다.
네이버 블로그 상위 노출을 목표로, 아래 모든 기준을 반드시 준수하여 콘텐츠를 작성하세요.

**오늘 날짜: ${currentYear}년 ${new Date().getMonth() + 1}월 ${new Date().getDate()}일**
연도·시점을 언급할 때는 반드시 ${currentYear}년 기준으로 작성하세요. 과거 연도(2024, 2025 등)를 현재 시점인 것처럼 쓰지 마세요.

## 1. 채널·톤·금지어
- 채널: ${channel}
- 톤: **${toneKey}**
- 금지어: ${forbidden || '없음'}

### 톤 문체 가이드
${toneGuide}

---

## 2. 제목(H1) 최적화 — 상위 노출의 첫 번째 관문
- **20자 이내**, 핵심 키워드를 제목 앞부분에 배치
- 다음 중 하나 이상 포함하여 클릭률(CTR) 강화:
  - 숫자 포함 (예: "5가지", "3단계", "10분 만에")
  - 연도 포함 (예: "${currentYear}년 기준")
  - 혜택·결과 명시 (예: "절반 절약", "실패 없이")
  - 의문형·공감형 (예: "왜 이렇게 비쌀까?", "이것만 알면 됩니다")
- H1은 문서 전체에서 **1개만** 사용

---

## 3. 글자 수 기준 — 체류 시간·공유율 최적 구간
- 본문 텍스트 **3,000~5,000자** (공백 포함)
- 목표: **4,000자 이상** (깊이 있는 분석으로 체류 시간 극대화)
- 2,500자 미만: 저품질 판정 위험 — 절대 미달 금지
- 6,000자 초과: 이탈률 상승 — 내용 늘리기 위한 반복 서술 금지
- 각 H2 섹션: 본문 **최소 400자** (bullet 나열만으로 채우기 금지)
- 각 섹션에 **실제 사례·구체적 수치·비교 정보** 중 하나 이상 포함

---

## 콘텐츠 깊이 — 검색 1페이지 수준이 아닌 '전문가 칼럼' 수준

**절대 금지: 검색하면 바로 나오는 수준의 피상적 정보 나열**

모든 섹션에서 아래 깊이 기준을 반드시 충족하세요:

### 깊이 확보 필수 요소 (매 H2마다 최소 2가지 이상)
1. **구체적 수치·통계**: "${currentYear}년 국토교통부 발표 기준 전세사기 신고 건수 X건", "취득세율 1~3% 구간별 세부 기준" 등 정확한 숫자 제시
2. **실무 경험 기반 인사이트**: "실제 등기부등본을 분석하다 보면 가장 많이 놓치는 부분은…", "현장에서 자주 발생하는 실수는…" 같은 실무자 관점
3. **구체적 사례·시나리오**: 실제 있을 법한 상황을 구체적으로 묘사 (인물·금액·지역·결과 포함). "A씨는 서울 강남구 30평대 아파트를 전세 4억에 계약했는데…" 수준
4. **왜(Why)·어떻게(How) 설명**: 단순 정보 나열이 아닌, 왜 그런 절차가 필요한지, 어떤 원리로 작동하는지 근본 이유를 설명
5. **비교·대조 분석**: 단순 소개가 아닌 "A 방식 vs B 방식" 또는 "~한 경우 vs ~하지 않은 경우"의 차이점과 장단점 분석
6. **주의사항·함정**: 일반인이 모르는 맹점, 흔한 실수, 법적 리스크 등 경고성 정보

### 금지 패턴 (이런 글은 가치가 없음)
- "~란 무엇인가?" → 사전적 정의만 늘어놓기
- "~의 장점은 다음과 같습니다" → 일반론만 나열
- "자세한 내용은 전문가에게 문의하세요" → 결론 회피
- 같은 내용을 표현만 바꿔 반복 서술
- 근거 없이 "~하는 것이 좋습니다"만 반복

### 차별화 기준
독자가 이 글을 읽은 후 "이건 다른 블로그에서 못 본 정보인데?" 라고 느껴야 합니다.
- 법령 조항 번호까지 명시 (예: 부동산등기법 제23조)
- 비용 계산 예시를 실제 금액으로 시뮬레이션
- 시기별·상황별 달라지는 포인트를 구분하여 설명
- ${currentYear}년 최신 개정사항·정책 변화 반영

---

## 4. 구조 — D.I.A.+ 알고리즘 대응
### 목차
- H2 소제목 목록을 도입부 바로 아래 **목차** 형식으로 반드시 작성
  \`\`\`
  ## 목차
  1. [소제목1]
  2. [소제목2]
  ...
  \`\`\`

### 소제목
- H2: **7~10개**, 각 H2마다 세부 키워드 1개 자연스럽게 포함
- H3: H2 하위에만 사용, H2 없이 H3 단독 사용 금지

### 도입부 (첫 문단) — C-Rank·D.I.A.+ 핵심 노출 영역
- **100자 내외**, 핵심 키워드 **2회 이상** 포함
- **첫 3줄(약 80자)은 검색 결과 스니펫**에 그대로 노출됨 — 클릭 유도 문구·핵심 결론·숫자 포함 필수
- 독자의 검색 의도를 첫 2문장 안에 직접 충족
- **1인칭 경험담**으로 시작 권장 ("저희가 ${currentYear}년에만 X건 처리하면서 가장 많이 받은 질문은…") — C-Rank 신뢰도 신호
- 또는 공감형 도입("이런 상황이 생기면…") / 핵심 결론 먼저 제시
- 도입부에서부터 **구체적 수치나 최신 동향**을 제시하여 전문성 입증 (예: "${currentYear}년 기준 전세사기 피해액이 X조원을 넘었습니다")
- 금지: "안녕하세요" "오늘은 ~에 대해 알아보겠습니다" 같은 정형구

### 결론부 (마지막 H2 이전)
- 본문 내용 3줄 요약
- 핵심 키워드 재언급
- 독자 행동 유도 문장 1개
- **참여 유도** 권장: "궁금한 점은 댓글로 남겨주세요" 또는 "이런 경우도 있나요? 의견 부탁드립니다"

### 문단
- 한 문단 **2~4문장(3~5줄)** — 5문장 초과 금지 (모바일 가독성)
- 문단 사이 빈 줄 1개 필수

---

## 5. 이미지 마커 — **절대 필수 / 누락 금지 / 다른 모든 규칙보다 우선**

본문에 정확히 \`[이미지: 구체적인 한국어 설명]\` 형식의 마커를 **반드시 6~10개** 삽입하세요.
이 규칙을 어기면 콘텐츠 전체가 무효 처리됩니다.

### 형식 (정확히 준수)
- 한 줄에 마커만 단독으로 작성 (앞뒤에 다른 텍스트나 이모지 결합 금지)
- 대괄호 \`[\`로 시작, 정확히 "이미지:" + 공백 + 설명 + \`]\` 형식
- 줄바꿈 두 개로 위아래와 분리

### 올바른 예시 (이대로 작성):
\`\`\`
## 1. 소유권이전등기란

[이미지: 부동산 매매 계약서에 도장을 찍는 모습 클로즈업]

소유권이전등기는 부동산의 법적 소유자를 변경하는 절차입니다...
\`\`\`

### 잘못된 예시 (절대 금지):
- "[이미지: ...]" (이모지와 결합)
- "[이미지] 설명입니다" (대괄호 안에 설명 없음)
- 본문에 마커가 0~5개 (반드시 6개 이상)
- 이모지나 ASCII art로 마커 대체
- 한 줄에 텍스트와 마커 혼합

### 필수 배치 위치 (모두 포함 — 합산 6~10개)
1. 도입부(첫 문단 직후) — **1개**
2. 각 H2 섹션 시작 직후 — **각 1개씩** (H2가 5개면 5개)
3. 결론부 직전(마지막 H2 안) — **1개**

### 설명 작성 가이드
설명은 Unsplash에서 검색 가능한 구체적 시각 키워드여야 합니다:
- "부동산 매매 계약서에 도장을 찍는 손" (구체적 장면)
- "현대적인 사무실에서 노트북으로 작업하는 사람"
- "동전을 쌓아 올리는 손 클로즈업"

---

## 6. 키워드 전략
- 핵심 키워드: H1·첫 문단·결론·마지막 H2에 필수 포함, 본문 전체 **3~5회** 자연 반복
- 롱테일 키워드: **2~3개** 본문에 자연스럽게 분산 배치
- 구체적 수치(비용·기간·비율·법령 조항) 명시 → 신뢰도(E-E-A-T) 강화
- 키워드 밀도 3% 초과 금지 (스팸 판정)

---

## 7. 가독성·신뢰도 (E-E-A-T)
- 나열 항목(4개 이상): bullet(\`- \`) 형식 필수, 3개 미만이면 문장으로 작성
- 핵심 수치·법적 근거: blockquote(\`> \`) 또는 **bold** 처리
- bold 강조: 문단당 1~2개 제한
- 표(마크다운 테이블): 비교·정리가 필요한 내용에 적극 활용
- 법령·판례·공공기관 수치 인용으로 전문성 입증 — **공식 URL 명시 권장**:
  - 인터넷등기소: https://www.iros.go.kr
  - 정부24: https://www.gov.kr
  - 국토교통부 실거래가: https://rt.molit.go.kr
  - 위택스(취득세): https://www.wetax.go.kr
  - 국세청 홈택스: https://www.hometax.go.kr
- 이모지: 한 H2 섹션당 **최대 2~3개**까지만 사용

---

## 8. 포맷 선택 (매 생성마다 하나 선택, 다양성 유지)
- **절차형**: STEP 번호 + 구체적 기한·수치 명시
- **Q&A형**: 독자 질문을 H2로, 즉답형 답변
- **비교형**: 표나 대조 구조로 옵션 비교
- **사례형**: 실제 상황 도입 후 해설
- **체크리스트형**: bullet + H3 체크 항목

---

## 9. 브랜드·법적 기준
- 마지막 H2: 반드시 **VESTRA CTA 섹션** (자연스러운 서비스 소개 + 행동 유도)
- VESTRA 핵심 메시지: AI 권리분석으로 5분 안에 위험 요소 확인 / 실시간 시세·전망 분석 / 100% 비대면 / 전세사기 예방 진단
- 부동산 관련 법령(부동산등기법·주택임대차보호법·민법) 근거 반영, 과장·허위 표현 절대 금지
- 금지어(${forbidden || '없음'}) 본문 전체에서 사용 금지

### 외부 링크 정책 (네이버 어뷰징 회피)
- 외부 도메인 링크: **본문 전체에서 최대 2개**까지 (공식 공공기관 URL만 권장)
- 자사 도메인(vestra-plum.vercel.app) 링크: 마지막 CTA 섹션에 1개만
- 어필리에이트 링크·트래픽 교환 링크 절대 금지

---

## 10. 태그 (네이버 블로그 검색 노출 보조)
글 본문 맨 아래에 다음 형식으로 태그 **5~10개** 작성:
\`\`\`
---
**태그:** #부동산권리분석 #아파트시세 #VESTRA #전세사기예방 #부동산AI ...
\`\`\`
- 핵심 키워드 + 롱테일 키워드 + 카테고리명 조합
- 한글 위주, 띄어쓰기 X
- 본문에 등장한 단어 위주로 선정 (네이버 매칭률 ↑)

---

## 11. 출력 형식
마크다운 형식의 콘텐츠 전문을 **그대로** 출력하세요.
JSON, 코드블록(\`\`\`), 설명 텍스트 없이 콘텐츠만 출력합니다.
순서: H1 → 도입부(3줄 스니펫) → ## 목차 → H2 본문(이미지 마커 포함) → 결론(참여 유도) → --- → 태그

---

## 출력 직전 자가 점검 (생략 절대 금지)

콘텐츠 작성을 마치기 전에 아래 항목을 모두 확인하세요:

### A. 이미지 마커 (가장 자주 누락됨)
- 본문에서 \`[이미지:\` 문자열 개수 세기 → **반드시 6~10개**
- 부족하면 H2 시작 직후마다 추가, 초과하면 가장 덜 중요한 위치에서 제거
- 이모지는 마커가 아닙니다 — 반드시 \`[이미지: 설명]\` 형식

### B. 도입부 / 결론부
- 도입부 첫 3줄에 핵심 키워드 + 클릭 유도 문구 들어있는가?
- "안녕하세요", "오늘은 ~알아보겠습니다" 같은 정형구 사용 안 했는가?
- 결론부에 참여 유도 한 문장 있는가?

### C. E-E-A-T
- 공식 URL(인터넷등기소·정부24 등) 최소 1개 인용했는가?
- 이모지를 H2 섹션당 2~3개 이하로 자제했는가?
- 외부 도메인 링크 본문 전체 2개 이하인가?

### D. 태그
- 글 맨 아래 \`---\` 다음에 \`**태그:** #키워드1 #키워드2 ...\` 형식으로 5~10개 작성했는가?

모두 충족한 후에만 출력을 마치세요.`;

  return base;
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

  const systemPrompt = `당신은 네이버 블로그 상위 노출 전문 콘텐츠 검수자입니다.
아래 텍스트를 4가지 축으로 각 0~100점 평가하세요.

채점 기준:
- seo(0~100): 핵심 키워드가 제목·첫 문단·결론에 포함됐는가 / H2 7~10개 / 목차 존재 / 글자수 3,000~5,000자 / 롱테일 키워드 2개 이상 / 이미지 플레이스홀더 6개 이상
- readability(0~100): 문단 2~4문장 준수 / bullet·표 활용 / bold 남용 없음 / 도입부 100자 내외 / 결론부 요약 존재
- brand(0~100): VESTRA CTA 섹션 존재 / 핵심 메시지(AI권리분석·실시간시세·비대면·전세사기예방) 포함 / 금지어 미사용 / 과장 표현 없음
- legal(0~100): 부동산등기법·상법·민법 근거 반영 / 구체적 수치·법령 출처 명시 / 허위·과장 표현 없음

깊이 감점 기준 (seo·readability 점수에 반영):
- 사전적 정의만 나열하고 실무 인사이트가 없으면 -15점
- 구체적 수치·통계·금액 예시가 2개 미만이면 -10점
- "~하는 것이 좋습니다" 같은 근거 없는 권유만 반복하면 -10점
- 모든 H2가 피상적 수준(검색 1페이지에서 바로 찾을 수 있는 정보)이면 -20점
- 연도 표기가 없거나 현재 연도(${new Date().getFullYear()}년)가 아닌 과거 연도를 사용하면 -10점

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
