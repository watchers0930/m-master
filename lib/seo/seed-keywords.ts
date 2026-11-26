// lib/seo/seed-keywords.ts — 주제(씨앗) 키워드 공용 규칙. 서버 검증(schemas/seo.ts)·공급자 요청(adapters/keywords.ts)·화면 입력이 함께 쓴다.
// 공급자 keywords_for_keywords 계약(공식 문서, 2026-11-27 확인): 한 번에 20개, 각 80자. 금지 문자는 공식 정규식 그대로 —
// 잘못된 키워드 하나가 묶음 전체를 실패시킬 수 있고 4바이트 문자(이모지 등)는 오류다.
// https://dataforseo.com/help-center/using-symbols-in-keywords-when-setting-a-google-ads-task
import { INVALID_RANGES_HEX } from "./seed-invalid-ranges";

export const SEED_LIMIT = 20;
export const SEED_MAX_CHARS = 80;
const INVALID_RANGES: ReadonlyArray<readonly [number, number]> = INVALID_RANGES_HEX.split(",").map((part) => {
  const [from, to = from] = part.split("-");
  return [parseInt(from, 16), parseInt(to, 16)] as const;
});
const invalidChar = (code: number) => INVALID_RANGES.some(([from, to]) => code >= from && code <= to);
const hasInvalidChar = (keyword: string) => {
  for (let i = 0; i < keyword.length; i++) if (invalidChar(keyword.charCodeAt(i))) return true;
  return false;
};

/** 키워드 하나의 문제(없으면 null). 입력은 NFKC·trim 된 값. */
export function seedKeywordIssue(keyword: string): string | null {
  if (!keyword) return "빈 키워드가 있습니다.";
  if (keyword.length > SEED_MAX_CHARS) return `‘${keyword.slice(0, 20)}…’ — 키워드는 ${SEED_MAX_CHARS}자 이하여야 합니다.`;
  if (hasInvalidChar(keyword)) return `‘${keyword}’ — 쓸 수 없는 기호·이모지가 있습니다(괄호·물음표·@ 등).`;
  return null;
}

/** 서버가 비교에 쓰는 형태: 대소문자 무시 중복 제거 + 정렬(lib/seo/audit.ts canonical·schemas/seo.ts와 같은 기준). */
export function canonicalSeeds(list: string[]): string[] {
  return [...new Map(list.map((k) => [k.toLowerCase(), k])).values()].sort();
}

/** 화면 입력(쉼표·줄바꿈 구분)을 키워드 목록으로. 자르지 않는다 — 넘치면 seedListIssue가 알린다. */
export function parseSeedKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.normalize("NFKC").trim())
    .filter(Boolean);
}

/** 목록 전체의 문제(없으면 null). 화면이 보내기 전에 같은 기준으로 알려 준다. 최종 판정은 서버 스키마. */
export function seedListIssue(list: string[]): string | null {
  if (canonicalSeeds(list).length > SEED_LIMIT) return `주제 키워드는 ${SEED_LIMIT}개까지 넣을 수 있습니다.`;
  for (const k of list) {
    const issue = seedKeywordIssue(k);
    if (issue) return issue;
  }
  return null;
}
