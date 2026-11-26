/** 브라우저·서버 공용 순수 텍스트 함수(node 모듈 의존 없음 — 질문 등록 화면도 같은 기준을 쓴다). */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * 질문에 별칭이 들어 있는가(브랜드 든 질문 판정). 정규화된 입력을 받는다.
 * 앞쪽만 단어 경계를 본다: 'PHP' 안의 'HP'는 아니고, 조사가 붙은 '베스트라의'는 맞다.
 */
export function aliasInQuestion(question: string, alias: string): boolean {
  if (!question || !alias) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, "u").test(question);
}
