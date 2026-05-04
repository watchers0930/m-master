import type { SourceAnalysis } from "./source-analysis-service";
import type { CreateProjectInput } from "../validators/project-validator";

export type ContextDraft = {
  summary: string;
  audience: string;
  tone: string;
  cta: string;
  bannedTerms: string;
};

function toDisplayDomain(domain?: string): string {
  if (!domain) {
    return "서비스 랜딩 페이지";
  }

  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function createAudienceHint(projectName: string, domain?: string): string {
  const domainHint = domain ? `${toDisplayDomain(domain)}에서 정보를 찾는 사용자` : "서비스 맥락을 먼저 파악해야 하는 사용자";
  return `${projectName}에 관심은 있지만 서비스 내용과 활용 장면을 빠르게 이해해야 하는 사용자, 그리고 이를 정확하게 설명해야 하는 실무 팀. 핵심 대상은 ${domainHint}이다.`;
}

function createTone(projectName: string): string {
  return `${projectName}의 톤은 과장 없이 구조적이고 신뢰감 있게 유지한다. 짧은 문장으로 핵심을 먼저 제시하고, 필요한 경우 체크리스트와 단계형 설명을 사용한다.`;
}

function createCta(projectName: string, domain?: string): string {
  if (domain) {
    return `${projectName} 관련 자세한 내용은 ${toDisplayDomain(domain)}에서 확인하고, 서비스 이해나 문의로 자연스럽게 이어지게 유도한다.`;
  }

  return `${projectName}의 상세 소개 자료 확인, 기능 이해, 문의 등록 같은 다음 행동으로 이어지게 유도한다.`;
}

function createBannedTerms(): string {
  return "근거 없는 1위·최고 표현, 확정 수익/성과 보장 문구, 확인되지 않은 비교 우위 표현, 과도한 공포 유발 문구는 금지한다.";
}

function summarizeSources(sourceAnalysis: SourceAnalysis): string {
  if (sourceAnalysis.totalFiles === 0) {
    return "선택된 문서가 아직 없어 기본 입력과 도메인 중심으로 초안을 구성한다.";
  }

  const fileTypes = sourceAnalysis.fileTypeBreakdown.slice(0, 2).map((entry) => `${entry.key} ${entry.count}건`).join(", ");

  if (sourceAnalysis.keywordHints.length > 0) {
    return `${sourceAnalysis.totalFiles}개 문서를 분석했고 형식은 ${fileTypes || "unknown"} 중심이다. 반복적으로 드러난 핵심 주제는 ${sourceAnalysis.keywordHints.join(", ")}다.`;
  }

  return `${sourceAnalysis.totalFiles}개 문서를 분석했고 형식은 ${fileTypes || "unknown"} 중심이다. 문서 구조와 서비스 설명 흐름을 기준으로 초안을 구성한다.`;
}

function buildKeywordNarrative(sourceAnalysis: SourceAnalysis): string {
  if (sourceAnalysis.keywordHints.length === 0) {
    return "사이트에서 반복적으로 드러나는 핵심 메시지를 중심으로 소개 구조를 정리한다.";
  }

  return `사이트와 자료에서 반복적으로 확인된 핵심 표현은 ${sourceAnalysis.keywordHints.slice(0, 4).join(", ")}이며, 이를 중심으로 서비스 가치와 사용 맥락을 정리한다.`;
}

function buildDigestNarrative(sourceAnalysis: SourceAnalysis): string {
  if (!sourceAnalysis.excerptDigest) {
    return "";
  }

  return `참고 문구 요약: ${sourceAnalysis.excerptDigest.slice(0, 220)}.`;
}

function buildSourceScopeHint(input: CreateProjectInput, sourceAnalysis: SourceAnalysis) {
  const hasOnlyWebsiteHtml =
    Boolean(input.domain) &&
    sourceAnalysis.totalFiles === 1 &&
    sourceAnalysis.fileTypeBreakdown.length === 1 &&
    sourceAnalysis.fileTypeBreakdown[0]?.key === "html";

  if (hasOnlyWebsiteHtml) {
    return "현재는 사이트 HTML 1건을 기준으로 문맥을 정리했고, 추가 문서는 아직 반영되지 않았다.";
  }

  if (input.workingPath && sourceAnalysis.totalFiles > 1) {
    return "연결된 작업 폴더 문서도 함께 반영해 서비스 설명 일관성을 맞췄다.";
  }

  if (input.workingPath) {
    return "작업 폴더는 연결됐지만 현재 초안에는 반영된 문서가 제한적이어서 후속 ingestion 보강이 필요하다.";
  }

  return "작업 폴더는 아직 연결되지 않았으며 후속 ingestion 단계에서 소스로 확장한다.";
}

export function buildContextDraft(
  input: CreateProjectInput,
  sourceAnalysis: SourceAnalysis,
): ContextDraft {
  const domainHint = input.domain
    ? `${toDisplayDomain(input.domain)}를 기준으로 브랜드와 서비스 문맥을 정리한`
    : "브랜드 문서와 입력값을 기준으로 서비스 문맥을 정리한";
  const pathHint = buildSourceScopeHint(input, sourceAnalysis);
  const sourceHint = summarizeSources(sourceAnalysis);
  const keywordNarrative = buildKeywordNarrative(sourceAnalysis);
  const digestNarrative = buildDigestNarrative(sourceAnalysis);

  return {
    summary: `${input.name}는 ${domainHint} 서비스다. ${sourceHint} ${keywordNarrative} ${digestNarrative} ${pathHint}`,
    audience: `${createAudienceHint(input.name, input.domain)} 문서와 웹페이지에 흩어진 설명을 한 문맥으로 정리해야 하는 실무 상황을 함께 고려한다.`,
    tone: createTone(input.name),
    cta: createCta(input.name, input.domain),
    bannedTerms: createBannedTerms(),
  };
}
