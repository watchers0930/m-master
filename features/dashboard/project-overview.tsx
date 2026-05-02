import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  EditableBrandProfileField,
  ProjectDetail,
  ProjectListItem,
} from "@/features/dashboard/types";

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
  loading?: boolean;
  onSelectProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onBrandProfileChange: (field: EditableBrandProfileField, value: string) => void;
  onSaveContext: () => Promise<void>;
  onApproveContext: () => Promise<void>;
};

export function ProjectOverview({
  projects,
  activeProject,
  loading = false,
  onSelectProject,
  onDeleteProject,
  onBrandProfileChange,
  onSaveContext,
  onApproveContext,
}: ProjectOverviewProps) {
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
            <div
              key={project.id}
              className={`project-item-shell ${activeProject?.project.id === project.id ? "active" : ""}`}
            >
              <button
                className="project-item"
                style={{ textAlign: "left" }}
                type="button"
                onClick={() => void onSelectProject(project.id)}
              >
                <strong>{project.name}</strong>
                <div className="project-meta">
                  <StatusPill active={activeProject?.project.id === project.id}>{project.status}</StatusPill>
                  <span className="fine-print">{project.domain || "도메인 미입력"}</span>
                  <span className="fine-print">{project.workingPath || "폴더 미지정"}</span>
                  <span className="fine-print">토픽 {project.topicCount}개</span>
                </div>
              </button>
              <div className="project-item-actions">
                <button className="button ghost danger" type="button" onClick={() => onDeleteProject(project.id)}>
                  삭제
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {activeProject?.brandProfile ? (
        <div className="insight-list">
          <div className="editor-grid">
            <InputField
              id="brand-summary"
              label="브랜드 요약"
              value={activeProject.brandProfile.summary}
              onChange={(value) => onBrandProfileChange("summary", value)}
              placeholder="브랜드와 서비스 핵심을 요약하세요."
              multiline
              rows={5}
            />
            <div className="field-grid-2">
              <InputField
                id="brand-audience"
                label="핵심 타겟"
                value={activeProject.brandProfile.audience || ""}
                onChange={(value) => onBrandProfileChange("audience", value)}
                placeholder="예: 운영 자동화가 필요한 중소 SaaS 팀"
                multiline
                rows={4}
              />
              <InputField
                id="brand-tone"
                label="톤"
                value={activeProject.brandProfile.tone || ""}
                onChange={(value) => onBrandProfileChange("tone", value)}
                placeholder="예: 명료하고 신뢰감 있게"
                multiline
                rows={4}
              />
            </div>
            <div className="field-grid-2">
              <InputField
                id="brand-cta"
                label="CTA"
                value={activeProject.brandProfile.cta || ""}
                onChange={(value) => onBrandProfileChange("cta", value)}
                placeholder="예: 데모 신청, 문의 유도"
                multiline
                rows={4}
              />
              <InputField
                id="brand-banned-terms"
                label="금지 표현"
                value={activeProject.brandProfile.bannedTerms || ""}
                onChange={(value) => onBrandProfileChange("bannedTerms", value)}
                placeholder="예: 업계 1위, 무조건, 100% 보장"
                multiline
                rows={4}
              />
            </div>
          </div>
          {activeProject.sourceAnalysis ? (
            <SourceAnalysisPanel
              analysis={activeProject.sourceAnalysis}
              title="참조 문서 요약"
              description="컨텍스트 초안이 어떤 파일 excerpt를 근거로 만들어졌는지 확인한 뒤 승인합니다."
            />
          ) : null}
          <div className="row">
            <StatusPill active={activeProject.brandProfile.approved}>
              {activeProject.brandProfile.approved ? "승인됨" : "검토 필요"}
            </StatusPill>
            <StatusPill>{`Version ${activeProject.brandProfile.version}`}</StatusPill>
            <StatusPill>{compactText(activeProject.brandProfile.audience, 28) || "타겟 미입력"}</StatusPill>
            <button className="button" disabled={loading} type="button" onClick={() => void onSaveContext()}>
              {loading ? "저장 중" : "컨텍스트 임시 저장"}
            </button>
            <button className="button ghost" disabled={loading} type="button" onClick={() => void onApproveContext()}>
              {loading ? "저장 중" : "컨텍스트 승인 저장"}
            </button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
