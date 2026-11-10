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
