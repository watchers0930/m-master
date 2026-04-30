import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import type { ProjectDetail, ProjectListItem } from "@/features/dashboard/types";

function compactText(value?: string | null, maxLength = 180) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "초안 없음";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

type ProjectOverviewProps = {
  projects: ProjectListItem[];
  activeProject?: ProjectDetail | null;
  onSelectProject: (projectId: string) => Promise<void>;
  onApproveContext: () => Promise<void>;
};

export function ProjectOverview({ projects, activeProject, onSelectProject, onApproveContext }: ProjectOverviewProps) {
  return (
    <SectionCard
      title="컨텍스트 승인 패널"
      description="폴더에서 읽은 문서와 도메인으로 만든 초안을 검토하고, 어떤 소스가 반영됐는지 함께 확인합니다."
      badge="Step 2"
    >
      <div className="project-list" style={{ marginBottom: 16 }}>
        {projects.length === 0 ? (
          <div className="empty-state">저장된 프로젝트가 아직 없습니다. 왼쪽에서 첫 프로젝트를 만들어 흐름을 시작하세요.</div>
        ) : (
          projects.map((project) => (
            <button
              key={project.id}
              className="project-item"
              style={{ textAlign: "left" }}
              type="button"
              onClick={() => void onSelectProject(project.id)}
            >
              <strong>{project.name}</strong>
              <div className="fine-print">
                {project.domain || "도메인 미입력"} · {project.workingPath || "폴더 미지정"} · 토픽 {project.topicCount}개
              </div>
            </button>
          ))
        )}
      </div>

      {activeProject?.brandProfile ? (
        <div className="insight-list">
          <div className="insight-item">
            <strong>요약</strong>
            <p className="fine-print">{compactText(activeProject.brandProfile.summary, 220)}</p>
          </div>
          <div className="insight-item">
            <strong>톤 및 CTA</strong>
            <p className="fine-print">{compactText(activeProject.brandProfile.tone, 130)}</p>
            <p className="fine-print">{compactText(activeProject.brandProfile.cta, 130)}</p>
          </div>
          {activeProject.sourceAnalysis ? (
            <div className="insight-item">
              <strong>참조 문서 요약</strong>
              <p className="fine-print">
                총 {activeProject.sourceAnalysis.totalFiles}개 파일, excerpt 보유 {activeProject.sourceAnalysis.filesWithExcerpt}개
              </p>
              <p className="fine-print">
                형식 분포: {activeProject.sourceAnalysis.fileTypeBreakdown.map((item) => `${item.key} ${item.count}`).join(", ") || "unknown"}
              </p>
              <p className="fine-print">
                키워드 힌트: {activeProject.sourceAnalysis.keywordHints.join(", ") || "없음"}
              </p>
            </div>
          ) : null}
          <div className="row">
            <StatusPill active={activeProject.brandProfile.approved}>
              {activeProject.brandProfile.approved ? "승인됨" : "검토 필요"}
            </StatusPill>
            <StatusPill>{`Version ${activeProject.brandProfile.version}`}</StatusPill>
            <button className="button ghost" type="button" onClick={() => void onApproveContext()}>
              컨텍스트 승인 저장
            </button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
