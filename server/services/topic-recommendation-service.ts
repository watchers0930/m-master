import type { ContextDraft } from "./context-draft-service";
import type { SourceAnalysis } from "./source-analysis-service";

type TopicIntent = "search" | "branding" | "conversion";

export type TopicDraft = {
  title: string;
  intentType: TopicIntent;
  score: number;
  rationale: string;
};

function displayDomain(domain?: string): string {
  return domain ? domain.replace(/^www\./, "") : "브랜드 자산";
}

export function normalizeTopicTitle(title: string, projectName: string): string {
  const cleaned = title
    .replace(/\s*:\s*[^:]{0,80}(?:,\s*[^,]{1,24}){1,}/g, "")
    .replace(/[-_]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 8) {
    return `${projectName} 핵심 기능과 사용 흐름 한눈에 보기`;
  }

  return cleaned;
}

export function buildTopicRecommendations(params: {
  projectName: string;
  domain?: string;
  contextDraft: ContextDraft;
  sourceAnalysis: SourceAnalysis;
}): TopicDraft[] {
  const domainLabel = displayDomain(params.domain);
  const sourceHint =
    params.sourceAnalysis.totalFiles > 0
      ? `${params.sourceAnalysis.totalFiles}개 문서에서 확인한 맥락을`
      : `${domainLabel}와 브랜드 핵심 메시지를`;
  const keywordHint =
    params.sourceAnalysis.keywordHints.length > 0
      ? ` 핵심 키워드는 ${params.sourceAnalysis.keywordHints.slice(0, 3).join(", ")}다.`
      : "";

  return [
    {
      title: `${params.projectName} 핵심 기능과 사용 흐름 한눈에 보기`,
      intentType: "search",
      score: 9.4,
      rationale: `${sourceHint} 빠르게 이해시키는 입문형 주제로, 검색과 블로그 원문 생성에 가장 안정적이다.${keywordHint}`,
    },
    {
      title: `${params.projectName}가 해결하는 문제와 실제 활용 장면`,
      intentType: "branding",
      score: 8.9,
      rationale: `브랜드 가치와 사용 흐름을 함께 설명할 수 있어 블로그 본문과 인스타그램 카드 요약으로 동시에 확장하기 쉽다.`,
    },
    {
      title: `${params.projectName} 도입 전 체크리스트`,
      intentType: "conversion",
      score: 8.5,
      rationale: `${params.contextDraft.cta}라는 행동 유도와 연결하기 쉽고, 페이스북 링크형 포스트로도 재활용하기 좋다.`,
    },
  ];
}
