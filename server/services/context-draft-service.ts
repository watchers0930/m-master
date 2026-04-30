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
  return domain ? domain.replace(/^www\./, "") : "서비스 랜딩 페이지";
}

function createAudienceHint(projectName: string, domain?: string): string {
  const domainHint = domain ? `${toDisplayDomain(domain)}를 먼저 찾는 잠재 고객` : "서비스 맥락을 먼저 파악해야 하는 잠재 고객";
  return `${projectName}에 관심은 있지만 정보를 흩어진 문서와 웹페이지에서 찾아야 하는 사용자, 그리고 이를 빠르게 정리해 전달해야 하는 실무 팀. 핵심 대상은 ${domainHint}이다.`;
}

function createTone(projectName: string): string {
  return `${projectName}의 톤은 과장 없이 구조적이고 신뢰감 있게 유지한다. 짧은 문장으로 핵심을 먼저 제시하고, 필요한 경우 체크리스트와 단계형 설명을 사용한다.`;
}

function createCta(projectName: string, domain?: string): string {
  if (domain) {
    return `${projectName} 관련 자세한 내용은 ${toDisplayDomain(domain)}에서 확인하고, 바로 적용 가능한 체크리스트나 상담/문의 흐름으로 이어지게 유도한다.`;
  }

  return `${projectName}의 상세 소개 자료 확인, 데모 요청, 문의 등록 같은 다음 행동으로 이어지게 유도한다.`;
}

function createBannedTerms(): string {
  return "근거 없는 1위·최고 표현, 확정 수익/성과 보장 문구, 확인되지 않은 비교 우위 표현, 과도한 공포 유발 문구는 금지한다.";
}

function summarizeSources(sourceAnalysis: SourceAnalysis): string {
  if (sourceAnalysis.totalFiles === 0) {
    return "선택된 문서가 아직 없어 기본 입력과 도메인 중심으로 초안을 구성한다.";
  }

  const files = sourceAnalysis.topSourceFiles
    .slice(0, 3)
    .map((file) => file.name)
    .join(", ");
  const fileTypes = sourceAnalysis.fileTypeBreakdown.slice(0, 2).map((entry) => `${entry.key} ${entry.count}건`).join(", ");
  const keywordSummary =
    sourceAnalysis.keywordHints.length > 0
      ? `핵심 키워드는 ${sourceAnalysis.keywordHints.join(", ")}다.`
      : "핵심 키워드는 아직 추가 추출이 필요하다.";

  return `${sourceAnalysis.totalFiles}개 문서를 분석했고 주요 파일은 ${files}이다. 형식은 ${fileTypes || "unknown"} 중심이다. ${keywordSummary}`;
}

export function buildContextDraft(
  input: CreateProjectInput,
  sourceAnalysis: SourceAnalysis,
): ContextDraft {
  const domainHint = input.domain
    ? `${toDisplayDomain(input.domain)}를 기준으로 브랜드와 서비스 문맥을 정리하는`
    : "브랜드 문서와 입력값을 기준으로 서비스 문맥을 정리하는";
  const pathHint = input.workingPath
    ? `작업 폴더 경로는 ${input.workingPath}로 기록하고 후속 ingestion 시 기준 소스로 활용한다.`
    : "작업 폴더는 아직 연결되지 않았으며 후속 ingestion 단계에서 소스로 확장한다.";
  const sourceHint = summarizeSources(sourceAnalysis);

  return {
    summary: `${input.name}는 ${domainHint} 컨텍스트 중심 마케팅 운영 프로젝트다. 블로그를 마스터 자산으로 두고 인스타그램과 페이스북으로 파생하는 원소스 멀티유즈 구조를 우선 설계한다. ${sourceHint} ${pathHint}`,
    audience: `${createAudienceHint(input.name, input.domain)} 문서를 빠르게 이해하고 바로 콘텐츠로 전환하려는 실무 맥락을 포함한다.`,
    tone: createTone(input.name),
    cta: createCta(input.name, input.domain),
    bannedTerms: createBannedTerms(),
  };
}
