// lib/ads/keyword-text.ts — 키워드 문자열 정규화·유효성의 단일 출처.
// 키워드 도구 정제(keywords.ts)와 등록기준 린터(lint.ts)가 같은 규칙을 쓰도록 여기서만 정의한다(두 번째 정규식 금지).
// - 허용 문자: 한글 음절·영문·숫자. 그 밖(특수문자·자모 단독·전각·이모지·제어문자)은 네이버 3906 대상으로 본다.
// - 씨앗(hintKeywords): 공백 없이 한 덩어리. 결과·등록 키워드: 단어 사이 공백 1칸 허용.
const KEYWORD_CHAR = "[가-힣A-Za-z0-9]";
const SEED_RE = new RegExp(`^${KEYWORD_CHAR}+$`);
const PHRASE_RE = new RegExp(`^${KEYWORD_CHAR}+(?: ${KEYWORD_CHAR}+)*$`);

/** 씨앗 최대 길이(설계 가정 — 네이버 공식 한도 미확인). */
export const MAX_KEYWORD_LENGTH = 40;

/** NFC → trim → 연속 공백을 한 칸으로. */
export const collapseKeyword = (text: string): string => text.normalize("NFC").trim().replace(/\s+/g, " ");

/** 중복 판정 키: 공백 제거 + 소문자. */
export const keywordDedupeKey = (text: string): string => text.replace(/ /g, "").toLowerCase();

/** 정규화된 씨앗(공백 없음)이 허용 문자로만 이뤄졌는가. */
export const isValidSeedText = (seed: string): boolean => SEED_RE.test(seed);

/** 정규화된(collapseKeyword) 키워드가 허용 문자 + 단어 사이 공백 1칸으로만 이뤄졌는가. */
export const isValidKeywordPhrase = (keyword: string): boolean => PHRASE_RE.test(keyword);

// 수동 씨앗 관련도(제안 품질 2026-11-11): 결과 키워드가 어떤 수동 씨앗과 ① 정규화 토큰(공백 단위·소문자) 하나가 같거나
// ② 한글 2글자 이상 연속 부분 문자열을 공유하면 관련 있다. ②는 '한글 2글자 쌍(bigram) 하나 공유'와 같다(2글자 이상 공통 ⇔ 공통 쌍 존재).
// 쌍은 토큰 안에서만 만든다(단어 경계를 넘는 쌍은 의미가 없다). 씨앗은 데이터일 뿐이다 — 여기서는 문자열 비교만 한다.
const HANGUL_PAIR_RE = /^[가-힣]{2}$/;
const tokensOf = (text: string): string[] => collapseKeyword(text).toLowerCase().split(" ").filter(isValidSeedText);
function addPairs(token: string, into: Set<string>): Set<string> {
  for (let i = 0; i + 2 <= token.length; i++) if (HANGUL_PAIR_RE.test(token.slice(i, i + 2))) into.add(token.slice(i, i + 2));
  return into;
}

/** 수동 씨앗(원문 — 공백으로 토큰을 나누기 위해 정제 전 값을 받는다. 문자열이 아니거나 허용 문자 밖 토큰은 무시) → 관련도 판정 함수. */
export function relevanceFilter(seeds: readonly unknown[]): (keyword: string) => boolean {
  const tokens = new Set<string>(), pairs = new Set<string>();
  for (const seed of seeds) {
    if (typeof seed !== "string") continue;
    for (const token of tokensOf(seed)) {
      tokens.add(token);
      addPairs(token, pairs);
    }
  }
  return (keyword) => tokensOf(keyword).some((token) => tokens.has(token) || [...addPairs(token, new Set())].some((p) => pairs.has(p)));
}
