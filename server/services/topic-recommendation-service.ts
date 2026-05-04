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
  if (!domain) {
    return "브랜드 자산";
  }

  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function createKeywordTopic(keyword: string, projectName: string): string {
  const normalized = keyword.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return `${projectName} 핵심 기능과 사용 흐름 한눈에 보기`;
  }

  return `${projectName}의 ${normalized} 활용 가이드`;
}

function buildKeywordPair(keywords: string[]) {
  const normalized = keywords
    .map((keyword) => keyword.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return "";
  }

  if (normalized.length === 1) {
    return normalized[0];
  }

  return `${normalized[0]}와 ${normalized[1]}`;
}

function createServiceContextTopic(projectName: string, keywords: string[]) {
  const pair = buildKeywordPair(keywords);

  if (!pair) {
    return `${projectName}가 해결하는 문제와 실제 활용 장면`;
  }

  return `${projectName}에서 보는 ${pair} 핵심 맥락`;
}

function createUserQuestionTopic(projectName: string, domainLabel: string, keywords: string[]) {
  const primary = keywords[0]?.replace(/\s+/g, " ").trim();

  if (!primary) {
    return `${projectName}를 처음 이해할 때 먼저 볼 포인트`;
  }

  return `${primary} 관점에서 ${projectName}를 이해할 때 먼저 볼 포인트`;
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
  const keywords = params.sourceAnalysis.keywordHints.slice(0, 4);
  const keywordTopic = keywords[0]
    ? createKeywordTopic(params.sourceAnalysis.keywordHints[0], params.projectName)
    : `${params.projectName} 핵심 기능과 사용 흐름 한눈에 보기`;
  const serviceContextTopic = createServiceContextTopic(params.projectName, keywords);
  const userQuestionTopic = createUserQuestionTopic(params.projectName, domainLabel, keywords);

  return [
    {
      title: keywordTopic,
      intentType: "search",
      score: 9.4,
      rationale: `${sourceHint} 빠르게 이해시키는 입문형 주제로, 사이트에서 가장 자주 드러난 메시지를 그대로 활용하기 좋다.${keywordHint}`,
    },
    {
      title: serviceContextTopic,
      intentType: "branding",
      score: 8.9,
      rationale: `반복적으로 드러난 키워드를 하나의 서비스 맥락으로 묶어 설명하기 좋다. 특히 ${domainLabel} 방문자가 처음 접하는 개념과 실제 활용 장면을 함께 정리하는 데 적합하다.`,
    },
    {
      title: userQuestionTopic,
      intentType: "conversion",
      score: 8.5,
      rationale: `${params.contextDraft.cta}라는 행동 유도와 연결하기 쉽고, 사용자가 실제로 궁금해할 판단 포인트를 정리하는 안내 문서로 활용하기 좋다.`,
    },
  ];
}
