import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import { StatusPill } from "@/components/ui/status-pill";
import type { EditableBrandProfileField, ProjectDetail, ProjectListItem } from "@/features/dashboard/types";

type ProjectOverviewProps = {
  projects: ProjectListItem[];
  activeProject?: ProjectDetail | null;
  loading?: boolean;
  onSelectProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onRegenerateContext: () => Promise<void>;
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
  onRegenerateContext,
  onBrandProfileChange,
  onSaveContext,
  onApproveContext,
}: ProjectOverviewProps) {
  return (
    <SectionCard
      title="브랜드 콘텍스트 정리"
      description="사이트에서 읽은 브랜드 요약, 타겟, 톤을 확인합니다. 여기서 정리한 내용이 이후 블로그, 인스타그램, 페이스북 초안의 기준이 됩니다."
      badge="Step 2"
    >
      {activeProject?.brandProfile ? (
        <div className="insight-list">
          <div className="step-focus-card">
            <strong>지금 할 일</strong>
            <p className="fine-print">
              아래 브랜드 요약만 먼저 읽고 필요한 부분만 고친 뒤 승인하세요. 타겟, 톤, CTA, 금지 표현은 필요할 때만 펼쳐 수정하면 됩니다.
            </p>
            <div className="button-row" style={{ marginTop: 12 }}>
              <button className="button ghost" disabled={loading} type="button" onClick={() => void onRegenerateContext()}>
                {loading ? "재생성 중" : "사이트 다시 읽기"}
              </button>
            </div>
          </div>

          <div className="insight-item">
            <strong>{activeProject.project.name}</strong>
            <div className="project-meta">
              <StatusPill active>{activeProject.project.status}</StatusPill>
              <span className="fine-print">{activeProject.project.domain || "사이트 주소 미입력"}</span>
              <span className="fine-print">{activeProject.project.workingPath || "폴더 미지정"}</span>
              <span className="fine-print">테마 {activeProject.topics.length}개</span>
            </div>
          </div>

          <InputField
            id="brand-summary"
            label="브랜드 요약"
            value={activeProject.brandProfile.summary}
            onChange={(value) => onBrandProfileChange("summary", value)}
            placeholder="브랜드와 서비스 핵심을 요약하세요."
            multiline
            rows={6}
          />

          <details className="inline-details">
            <summary>고급 편집 열기</summary>
            <div className="inline-details-body editor-grid">
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
          </details>

          <details className="inline-details">
            <summary>수집 근거와 다른 프로젝트 보기</summary>
            <div className="inline-details-body stack">
              <p className="fine-print">
                재생성은 현재 저장된 프로젝트명과 사이트 주소, 그리고 연결된 자료를 기준으로 새 콘텍스트 초안을 만듭니다.
              </p>
              {activeProject.sourceAnalysis ? (
                <SourceAnalysisPanel
                  analysis={activeProject.sourceAnalysis}
                  title="참조 문서 요약"
                  description="콘텍스트 초안이 어떤 사이트/파일 내용을 근거로 만들어졌는지 확인한 뒤 승인합니다."
                />
              ) : null}

              <div className="project-list">
                {projects.length === 0 ? (
                  <div className="empty-state">저장된 프로젝트가 아직 없습니다.</div>
                ) : (
                  projects.map((project) => (
                    <div
                      key={project.id}
                      className={`project-item-shell ${activeProject.project.id === project.id ? "active" : ""}`}
                    >
                      <button
                        className="project-item"
                        style={{ textAlign: "left" }}
                        type="button"
                        onClick={() => void onSelectProject(project.id)}
                      >
                        <strong>{project.name}</strong>
                        <div className="project-meta">
                          <StatusPill active={activeProject.project.id === project.id}>{project.status}</StatusPill>
                          <span className="fine-print">{project.domain || "사이트 주소 미입력"}</span>
                          <span className="fine-print">{project.workingPath || "폴더 미지정"}</span>
                          <span className="fine-print">테마 {project.topicCount}개</span>
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
            </div>
          </details>
          <div className="row">
            <StatusPill active={activeProject.brandProfile.approved}>
              {activeProject.brandProfile.approved ? "승인됨" : "검토 필요"}
            </StatusPill>
            <StatusPill>{`Version ${activeProject.brandProfile.version}`}</StatusPill>
            <button className="button" disabled={loading} type="button" onClick={() => void onSaveContext()}>
              {loading ? "저장 중" : "콘텍스트 저장"}
            </button>
            <button className="button primary" disabled={loading} type="button" onClick={() => void onApproveContext()}>
              {loading ? "저장 중" : "이 콘텍스트로 진행"}
            </button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
