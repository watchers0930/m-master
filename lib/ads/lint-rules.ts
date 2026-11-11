// lib/ads/lint-rules.ts — 등록기준 린터 규칙 데이터(설계서 §4-4: 규칙은 데이터로 분리하고 근거·확인일을 함께 둔다).
// verifiedAt: null = 네이버 공식 문서·광고시스템 화면에서 아직 확인하지 않은 값(설계서 §8). Task 13에서 실측해 갱신한다.
// lint.ts는 한도·사전·문자 집합을 여기서만 읽는다(하드코딩 금지).
import { MAX_KEYWORD_LENGTH } from "./keyword-text";

export type LintRule = {
  id: string;
  description: string;
  basis: string;
  verifiedAt: string | null; // 'YYYY-MM-DD'
  source: string;
  limit?: number;
};

const UNVERIFIED_GUIDE = "설계 가정(네이버 광고 검수 가이드 일반 관행, 원문 미확인)";

export const LINT_RULES = {
  inputType: { id: "input-type", description: "문자열이 아닌 입력", basis: "입력 방어(크래시 대신 위반으로 보고)", verifiedAt: null, source: "내부 규칙" },
  inputTooLong: {
    id: "input-too-long", description: "비정상적으로 긴 입력", basis: "입력 방어(정규식 처리 전에 차단)", verifiedAt: null, source: "내부 규칙",
    limit: 1000,
  },
  required: { id: "required", description: "빈 제목·설명", basis: "TEXT_45 소재는 제목·설명이 필수", verifiedAt: null, source: "설계 가정" },
  headlineLength: {
    id: "headline-length", description: "제목 글자 수 초과", basis: "NFC 정규화 후 코드포인트 수(공백 포함, 전각 1자). 네이버 계산 방식 미확인",
    verifiedAt: null, source: "설계 가정", limit: 15,
  },
  descriptionLength: {
    id: "description-length", description: "설명 글자 수 초과", basis: "NFC 정규화 후 코드포인트 수(공백 포함, 전각 1자). 네이버 계산 방식 미확인",
    verifiedAt: null, source: "설계 가정", limit: 45,
  },
  superlative: {
    id: "superlative", description: "최상급·보장 표현", basis: "근거 없는 최상급·보장 표현은 검수 반려 대상(표시광고법 취지)",
    verifiedAt: null, source: UNVERIFIED_GUIDE,
  },
  forbiddenChar: {
    id: "forbidden-char", description: "허용 문자 외 특수문자", basis: "장식용 기호(★♥▶ 등)·자모 단독·전각 문자 등 허용 목록 밖 문자",
    verifiedAt: null, source: UNVERIFIED_GUIDE,
  },
  controlChar: { id: "control-char", description: "제어문자(줄바꿈·탭 포함)", basis: "소재 문구는 한 줄 텍스트", verifiedAt: null, source: "내부 규칙" },
  zeroWidthChar: {
    id: "zero-width-char", description: "보이지 않는 문자(ZWSP·ZWJ·BOM 등)", basis: "검수 우회·표시 깨짐 방지", verifiedAt: null, source: "내부 규칙",
  },
  emoji: { id: "emoji", description: "이모지·그림문자", basis: "장식 기호와 같은 취급", verifiedAt: null, source: UNVERIFIED_GUIDE },
  duplicateCreative: {
    id: "duplicate-creative", description: "같은 광고그룹 내 중복 소재", basis: "네이버 에러 3822(중복 소재). 비교 기준(NFC·공백 정리·대소문자 무시)은 설계 가정",
    verifiedAt: null, source: "에러 코드 존재는 Error Code Map에서 확인(설계서 §2, 2026-11-09). 판정 기준은 설계 가정",
  },
  keywordEmpty: { id: "keyword-empty", description: "빈 키워드", basis: "공백뿐인 키워드는 등록 불가", verifiedAt: null, source: "내부 규칙" },
  keywordSpecialChar: {
    id: "keyword-special-char", description: "키워드 특수문자", basis: "네이버 에러 3906(특수문자). 허용 문자는 keyword-text.ts(Task 6과 단일 출처)",
    verifiedAt: null, source: "에러 코드 존재는 Error Code Map에서 확인(설계서 §2, 2026-11-09). 허용 문자 집합은 설계 가정",
  },
  keywordLength: {
    id: "keyword-length", description: "키워드 길이 초과", basis: "Task 6 씨앗 상한과 같은 값(네이버 공식 한도 미확인)",
    verifiedAt: null, source: "설계 가정", limit: MAX_KEYWORD_LENGTH,
  },
  forbiddenKeyword: {
    id: "forbidden-keyword", description: "노출 금지 가능성이 있는 키워드", basis: "네이버 에러 3909(노출 금지 키워드). 사전은 초기 추정 목록",
    verifiedAt: null, source: "설계 가정",
  },
} as const satisfies Record<string, LintRule>;

/** 금지 키워드 사전 초기 목록(정규화 형태: 소문자·공백 없음). 네이버 공식 목록이 아니다 — 원금·수익 보장류 금융 표현과
 *  명백한 불법 서비스 용어를 보수적으로 추정한 것이다. Task 13 실측과 실제 3909 반려 사례로 다듬는다.
 *  매칭: 키워드를 정규화(NFC·전각→반각·소문자·공백 정리)해 토큰으로 나누고, 토큰 경계에서 시작·끝나는 연속 토큰을
 *  공백 없이 이어 붙인 값이 사전어와 같을 때만 잡는다("원금 보장"은 위반, "원금보장형예금"은 통과). */
export const FORBIDDEN_KEYWORDS: readonly string[] = ["원금보장", "확정수익", "고수익보장", "작업대출", "대포통장", "불법대출", "명의대여"];

/** 최상급·보장 표현 사전. pattern은 정규화된 텍스트(NFC·전각→반각·공백/보이지 않는 문자 제거·소문자)에 적용한다.
 *  결정(오탐): '최고급'은 등급 우위 주장이라 잡는다. '유일하게'도 유일성 주장이라 잡는다. 숫자가 앞에 붙은 '21위'·'1000%'는 잡지 않는다. */
export const SUPERLATIVE_TERMS: readonly { term: string; pattern: RegExp }[] = [
  { term: "최고", pattern: /최고/g },
  { term: "최상", pattern: /최상/g },
  { term: "최초", pattern: /최초/g },
  { term: "최저", pattern: /최저/g },
  { term: "1위", pattern: /(?<![0-9.])1위/g },
  { term: "No.1", pattern: /(?<![a-z])no\.?1(?![0-9])/g },
  { term: "넘버원", pattern: /넘버원/g },
  { term: "100%", pattern: /(?<![0-9.,])100%/g },
  { term: "100퍼센트", pattern: /(?<![0-9.,])100퍼센트/g },
  { term: "백퍼센트", pattern: /백퍼센트/g },
  { term: "보장", pattern: /보장/g },
  { term: "유일", pattern: /유일/g },
  { term: "완벽", pattern: /완벽/g },
  { term: "무조건", pattern: /무조건/g },
];

/** 매칭 전 지우는 구분 부호(정규화 후 기준). 양옆(연속 부호 묶음의 앞뒤)이 모두 한글 음절이나 숫자일 때만 지운다("최.고"·"보-장"·"1-0-0%" 우회 차단).
 *  예외: 숫자와 숫자 사이의 '.'·','는 소수점·자릿수 표기라 지우지 않는다("10.0%"·"1,100%"·"2.1위"가 최상급이 되지 않게).
 *  결정(오탐): "전세. 보증금"처럼 단어 사이 부호도 지워지지만, 이어 붙인 결과가 사전어를 만들 때만 위반이 된다(공백 제거와 같은 수준의 위험). */
export const MATCH_SEPARATORS = new Set([".", ",", "-", "·", "•", "‧", "・", "_", "/", "~", "*", "+", "|", ":", ";", "^", "=", "'", "\"", "`"]);
export const MATCH_SEPARATOR_KEEP_BETWEEN_DIGITS = new Set([".", ","]);

/** 최상급 사전과 겹쳐도 주장 표현이 아닌 일반 명사. pattern 은 정규화된 형태에 적용하고, 원문에서도 띄어쓰기·부호·보이지 않는
 *  문자 없이 붙어 있을 때만 예외다('최.고가'·'최고 가성비'·'최상 층간'은 계속 잡는다). 이 범위 안의 매치만 무시하고
 *  같은 문구 안의 다른 최상급은 그대로 잡는다. '최초'는 사실 용어 예외가 없다(최초 주장 자체가 최상급). */
export type SuperlativeException = { term: string; pattern: RegExp; basis: string; verifiedAt: string | null; source: string };
const OWNER_DECISION = "대장 결정 2026-11-12";
export const SUPERLATIVE_EXCEPTIONS: readonly SuperlativeException[] = [
  { term: "보장성", pattern: /보장성/g, basis: "보험 상품 분류(주장 아님)", verifiedAt: null, source: "설계 결정(오탐, 린터 도입 1761941)" },
  { term: "최고경영자", pattern: /최고경영자/g, basis: "직함(주장 아님)", verifiedAt: null, source: "설계 결정(오탐, 린터 도입 1761941)" },
  // '최고가성비'·'최고가치'는 '최고+가성비/가치' 최상급이라 예외에서 뺀다
  { term: "최고가", pattern: /최고가(?!성비|치)/g, basis: "부동산 실거래 최고 가격(사실 용어)", verifiedAt: null, source: OWNER_DECISION },
  { term: "최상층", pattern: /최상층/g, basis: "건물 맨 위층(사실 용어)", verifiedAt: null, source: OWNER_DECISION },
  // '수익·원금·확정 보장금액'은 수익 보장 주장이라 예외에서 뺀다
  { term: "보장금액", pattern: /(?<!수익|원금|확정)보장금액/g, basis: "보험 보장(가입) 금액(사실 용어)", verifiedAt: null, source: OWNER_DECISION },
];

/** 소재 문구 허용 문자(이 밖은 forbidden-char). 한글 음절·영문·숫자·공백·일반 문장부호. 자모 단독·전각·한자는 허용하지 않는다(설계 가정). */
export const ALLOWED_COPY_CHAR = /^[가-힣A-Za-z0-9 .,!?'"()[\]\-/&%~:;+·#@_“”‘’]$/;

type CodeRange = readonly [number, number];
const inRanges = (ranges: readonly CodeRange[]) => (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? -1;
  return ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
};
/** 제어문자: C0(0x00–0x1F, 줄바꿈·탭 포함)·DEL·C1. */
export const CONTROL_RANGES: readonly CodeRange[] = [[0x00, 0x1f], [0x7f, 0x9f]];
/** 보이지 않는 문자: 소프트 하이픈, ZWSP·ZWNJ·ZWJ·LRM·RLM, 줄/문단 구분자·방향 제어, WORD JOINER 등, 변형 선택자, BOM. */
export const ZERO_WIDTH_RANGES: readonly CodeRange[] = [
  [0x00ad, 0x00ad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0xfe00, 0xfe0f], [0xfeff, 0xfeff],
];
export const isControlChar = inRanges(CONTROL_RANGES);
export const isZeroWidthChar = inRanges(ZERO_WIDTH_RANGES);
export const EMOJI_CHAR = /^[\p{Extended_Pictographic}\p{Regional_Indicator}]$/u;
