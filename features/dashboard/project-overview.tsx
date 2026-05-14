import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import { StatusPill } from "@/components/ui/status-pill";
import type { EditableBrandProfileField, ProjectDetail, ProjectListItem } from "@/features/dashboard/types";

type ProjectOverviewProps = {
  projects: ProjectListItem[];
  activeProject?: ProjectDetail | null;
  loading?: boolean;
  planBusy?: boolean;
  onSelectProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onRegenerateContext: () => Promise<void>;
  onProjectIndustryChange: (value: string) => void;
  onProjectAnalyticsFieldChange: (
    field: "analyticsSourceType" | "analyticsSourceId" | "analyticsSourceLabel" | "analyticsEndpointUrl" | "analyticsAccessKey",
    value: string,
  ) => void;
  onSaveProjectSettings: () => Promise<void>;
  onGenerateMonthlyPlan: (autoGenerate: boolean) => Promise<void>;
  onRunMonthlyPlan: () => Promise<void>;
  onBrandProfileChange: (field: EditableBrandProfileField, value: string) => void;
  onSaveContext: () => Promise<void>;
  onApproveContext: () => Promise<void>;
};

export function ProjectOverview({
  projects,
  activeProject,
  loading = false,
  planBusy = false,
  onSelectProject,
  onDeleteProject,
  onRegenerateContext,
  onProjectIndustryChange,
  onProjectAnalyticsFieldChange,
  onSaveProjectSettings,
  onGenerateMonthlyPlan,
  onRunMonthlyPlan,
  onBrandProfileChange,
  onSaveContext,
  onApproveContext,
}: ProjectOverviewProps) {
  const analyticsType = activeProject?.project.analyticsSourceType || "ga4";
  const latestPlan = activeProject?.latestContentPlan;

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
              <span className="fine-print">{activeProject.project.industry || "업종 미지정"}</span>
              <span className="fine-print">{activeProject.project.workingPath || "폴더 미지정"}</span>
              <span className="fine-print">테마 {activeProject.topics.length}개</span>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="project-industry-setting">
              업종 분류
            </label>
            <div className="row">
              <select
                id="project-industry-setting"
                className="text-input"
                value={activeProject.project.industry || "general"}
                onChange={(event) => onProjectIndustryChange(event.target.value)}
              >
                <option value="general">일반</option>
                <option value="real-estate">부동산</option>
                <option value="marketing">마케팅</option>
                <option value="saas">SaaS</option>
                <option value="finance">금융</option>
              </select>
              <button className="button" disabled={loading} type="button" onClick={() => void onSaveProjectSettings()}>
                {loading ? "저장 중" : "업종 저장"}
              </button>
            </div>
            <p className="fine-print">업종 분류를 바꾸면 이후 해시태그 추천과 채널 초안 우선 태그가 이 값을 먼저 참조합니다.</p>
          </div>

          <details className="inline-details" open>
            <summary>GA4 기반 월간 계획 연결</summary>
            <div className="inline-details-body stack">
              <p className="fine-print">
                등록된 분석 소스를 기준으로 최근 30일 유입을 읽고, 이번 달 4주 콘텐츠 계획을 만든 뒤 계획에 맞춰 초안을 생성합니다.
              </p>
              <div className="field-group">
                <label className="field-label" htmlFor="analytics-source-type">
                  분석 소스 유형
                </label>
                <select
                  id="analytics-source-type"
                  className="text-input"
                  value={analyticsType}
                  onChange={(event) => onProjectAnalyticsFieldChange("analyticsSourceType", event.target.value)}
                >
                  <option value="ga4">등록된 GA4 소스</option>
                  <option value="external">외부 집계 엔드포인트</option>
                </select>
              </div>

              <div className="field-grid-2">
                <InputField
                  id="analytics-source-label"
                  label="대시보드 표시 이름"
                  value={activeProject.project.analyticsSourceLabel || ""}
                  onChange={(value) => onProjectAnalyticsFieldChange("analyticsSourceLabel", value)}
                  placeholder="예: vestra"
                />
                {analyticsType === "ga4" ? (
                  <InputField
                    id="analytics-source-id"
                    label="GA4 소스 ID"
                    value={activeProject.project.analyticsSourceId || ""}
                    onChange={(value) => onProjectAnalyticsFieldChange("analyticsSourceId", value)}
                    placeholder="예: vestra 또는 m-master"
                  />
                ) : (
                  <InputField
                    id="analytics-endpoint-url"
                    label="집계 API URL"
                    value={activeProject.project.analyticsEndpointUrl || ""}
                    onChange={(value) => onProjectAnalyticsFieldChange("analyticsEndpointUrl", value)}
                    placeholder="https://example.com/api/public/analytics/overview"
                  />
                )}
              </div>

              {analyticsType === "external" ? (
                <InputField
                  id="analytics-access-key"
                  label="접근 키"
                  value={activeProject.project.analyticsAccessKey || ""}
                  onChange={(value) => onProjectAnalyticsFieldChange("analyticsAccessKey", value)}
                  placeholder="필요한 경우에만 입력"
                />
              ) : null}

              <div className="row">
                <button className="button" disabled={loading} type="button" onClick={() => void onSaveProjectSettings()}>
                  {loading ? "저장 중" : "분석 소스 저장"}
                </button>
                {activeProject.project.analyticsConnectedAt ? (
                  <span className="fine-print">{`연결 저장: ${new Date(activeProject.project.analyticsConnectedAt).toLocaleString("ko-KR")}`}</span>
                ) : (
                  <span className="fine-print">아직 분석 소스가 저장되지 않았습니다.</span>
                )}
              </div>
            </div>
          </details>

          <details className="inline-details" open>
            <summary>월간 콘텐츠 계획</summary>
            <div className="inline-details-body stack">
              <div className="row">
                <button className="button" disabled={planBusy} type="button" onClick={() => void onGenerateMonthlyPlan(false)}>
                  {planBusy ? "계획 생성 중" : "이번 달 계획 생성"}
                </button>
                <button className="button ghost" disabled={planBusy} type="button" onClick={() => void onGenerateMonthlyPlan(true)}>
                  {planBusy ? "설정 중" : "자동 생성 계획으로 저장"}
                </button>
                <button
                  className="button primary"
                  disabled={planBusy || !latestPlan}
                  type="button"
                  onClick={() => void onRunMonthlyPlan()}
                >
                  {planBusy ? "실행 중" : "계획대로 콘텐츠 생성"}
                </button>
              </div>
              {latestPlan ? (
                <div className="stack">
                  <div className="project-meta">
                    <StatusPill active={latestPlan.status === "scheduled" || latestPlan.status === "completed"}>
                      {latestPlan.status}
                    </StatusPill>
                    <span className="fine-print">{latestPlan.monthKey}</span>
                    <span className="fine-print">{latestPlan.autoGenerate ? "자동 생성 켜짐" : "수동 실행"}</span>
                    {latestPlan.lastExecutedAt ? (
                      <span className="fine-print">{`최근 실행 ${new Date(latestPlan.lastExecutedAt).toLocaleString("ko-KR")}`}</span>
                    ) : null}
                  </div>
                  {latestPlan.basisSummary ? <p className="fine-print">{latestPlan.basisSummary}</p> : null}
                  <div className="project-list">
                    {latestPlan.items.map((item) => (
                      <div key={item.id} className="project-item-shell">
                        <div className="project-item" style={{ cursor: "default" }}>
                          <strong>{`${item.weekLabel} · ${item.topic}`}</strong>
                          <div className="project-meta">
                            <StatusPill active={item.status === "generated"}>{item.status}</StatusPill>
                            <span className="fine-print">{item.intentType || "search"}</span>
                            {item.generatedAt ? (
                              <span className="fine-print">{`생성 ${new Date(item.generatedAt).toLocaleString("ko-KR")}`}</span>
                            ) : null}
                          </div>
                          {item.objective ? <p className="fine-print">{item.objective}</p> : null}
                          {item.rationale ? <p className="fine-print">{item.rationale}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="fine-print">아직 생성된 월간 계획이 없습니다. 분석 소스를 저장한 뒤 이번 달 계획 생성부터 실행하세요.</p>
              )}
            </div>
          </details>

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
