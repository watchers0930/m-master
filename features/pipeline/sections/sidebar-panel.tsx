"use client";

import { useRef, type ChangeEvent } from "react";
import { InputField } from "@/components/ui/input-field";
import { OperationsBoard } from "../components/operations-board";
import type {
  ProjectListItem,
  ProjectDetail,
  SeoComplianceResult,
  VariantGroup,
  StudioDetail,
  BlogPublishPackage,
  MonthlyContentPlan,
  AutomationReadinessReport,
  ChannelPublicationSummary,
  AutomationRunSummary,
  AutomationReviewResolution,
  BulkOperationHistoryItem,
  BulkOperationReport,
  SourceFileDraft,
} from "../types";

type Props = {
  /* Project */
  projects: ProjectListItem[];
  activeProject: ProjectDetail | null;
  name: string;
  onNameChange: (v: string) => void;
  domain: string;
  onDomainChange: (v: string) => void;
  workingPath: string;
  onWorkingPathChange: (v: string) => void;
  sourceFiles: SourceFileDraft[];
  onSourceFilesChange: (files: SourceFileDraft[]) => void;
  projectBusy: boolean;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  /* Generation */
  topicInput: string;
  onTopicInputChange: (v: string) => void;
  generateBusy: boolean;
  onGenerate: () => void;
  contentPlan: MonthlyContentPlan | null;
  planBusy: boolean;
  onGenerateContentPlan: () => void;
  selectedPlannedTopicId: string | null;
  onSelectPlannedTopic: (itemId: string, topicTitle: string) => void;
  /* A/B */
  topic: string;
  variantGroup: VariantGroup | null;
  abGenerateBusy: boolean;
  onGenerateVariants: (count: number) => void;
  adoptBusy: string | null;
  onAdoptVariant: (id: string) => void;
  /* SEO */
  seoCompliance: SeoComplianceResult | null;
  /* Review */
  studio: StudioDetail | null;
  /* Tone & Hashtag */
  editingHashtags: string;
  onEditingHashtagsChange: (v: string) => void;
  hashtagBusy: boolean;
  onGenerateHashtags: () => void;
  /* Publish */
  exportBusy: boolean;
  onExportAll: () => void;
  publishBusy: boolean;
  publishPackage: BlogPublishPackage | null;
  onPreparePublish: () => void;
  publications: ChannelPublicationSummary[];
  failedPublications: ChannelPublicationSummary[];
  publishedPublications: ChannelPublicationSummary[];
  readiness: AutomationReadinessReport | null;
  automationBusy: boolean;
  automationRun: AutomationRunSummary | null;
  automationFeedback: AutomationReviewResolution | null;
  publicationFeedback: string | null;
  bulkReport: BulkOperationReport | null;
  bulkReportHistory: BulkOperationHistoryItem[];
  reviewQueue: MonthlyContentPlan["items"];
  readyQueue: MonthlyContentPlan["items"];
  failedQueue: MonthlyContentPlan["items"];
  publishedQueue: MonthlyContentPlan["items"];
  onRunAutomation: () => void;
  onApproveReview: (planItemId: string) => void;
  onRetryPlanItem: (planItemId: string) => void;
  onRetryPublication: (publicationId: string) => void;
  onBulkApproveReview: (planItemIds: string[]) => void;
  onBulkRetryPlanItems: (planItemIds: string[]) => void;
  onBulkRetryPublications: (publicationIds: string[]) => void;
};

export function SidebarPanel(props: Props) {
  const {
    projects, activeProject,
    name, onNameChange, domain, onDomainChange,
    workingPath, onWorkingPathChange, sourceFiles, onSourceFilesChange,
    projectBusy, onCreateProject, onSelectProject,
    editingHashtags, onEditingHashtagsChange, hashtagBusy, onGenerateHashtags,
    topicInput, onTopicInputChange, generateBusy, onGenerate,
    contentPlan, planBusy, onGenerateContentPlan, selectedPlannedTopicId, onSelectPlannedTopic,
    topic, variantGroup, abGenerateBusy, onGenerateVariants, adoptBusy, onAdoptVariant,
    seoCompliance,
    studio,
    exportBusy, onExportAll,
    publishBusy, publishPackage, onPreparePublish,
    publications, failedPublications, publishedPublications,
    readiness,
    automationBusy,
    automationRun,
    automationFeedback, publicationFeedback, bulkReport,
    bulkReportHistory,
    reviewQueue,
    readyQueue,
    failedQueue,
    publishedQueue,
    onRunAutomation,
    onApproveReview,
    onRetryPlanItem,
    onRetryPublication,
    onBulkApproveReview,
    onBulkRetryPlanItems,
    onBulkRetryPublications,
  } = props;

  const bp = activeProject?.brandProfile;
  const isApproved = bp?.approved === true;
  const review = studio?.review;
  const scores = review?.scores;
  const hasContent = (studio?.draft?.assets?.length ?? 0) > 0;
  const adoptedVariant = variantGroup?.variants?.find((v) => v.adopted);
  const averageScore = scores
    ? Math.round((scores.brandAlignment + scores.formatFit + scores.ctaClarity + scores.riskControl) / 4)
    : null;
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function normalizeFileDraft(file: File): SourceFileDraft {
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : undefined;
    const relativePath = "webkitRelativePath" in file && typeof file.webkitRelativePath === "string" ? file.webkitRelativePath || undefined : undefined;

    return {
      name: file.name,
      relativePath,
      mimeType: file.type || undefined,
      extension,
      size: file.size,
      lastModified: new Date(file.lastModified).toISOString(),
    };
  }

  function handleFolderSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    const nextFiles = files.map(normalizeFileDraft);
    onSourceFilesChange(nextFiles);

    const firstRelativePath = nextFiles[0]?.relativePath;
    const rootFolder = firstRelativePath?.split("/")[0] || files[0].name;
    onWorkingPathChange(rootFolder);
    event.target.value = "";
  }

  function handleReferenceFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    const nextFiles = files.map(normalizeFileDraft);
    onSourceFilesChange([...sourceFiles, ...nextFiles]);
    event.target.value = "";
  }

  return (
    <aside className="sidebar-panel">
      {activeProject ? (
        <section className="sb-overview">
          <div className="sb-overview-head">
            <div>
              <p className="sb-kicker">Active Project</p>
              <strong>{activeProject.project.name}</strong>
              <span>{activeProject.project.domain || "도메인 없음"}</span>
            </div>
            {isApproved ? <span className="status-pill active">승인됨</span> : <span className="status-pill">점검 필요</span>}
          </div>
          <div className="sb-overview-metrics">
            <div className="sb-metric-chip">
              <span>월간 계획</span>
              <strong>{contentPlan?.items?.length ?? 0}건</strong>
            </div>
            <div className="sb-metric-chip">
              <span>검토 큐</span>
              <strong>{reviewQueue.length}건</strong>
            </div>
            <div className="sb-metric-chip">
              <span>검증</span>
              <strong>{averageScore ? `${averageScore}점` : "-"}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── 프로젝트 ── */}
      <details className="sb-section" open>
        <summary className="sb-section-title">프로젝트</summary>
        <div className="sb-section-body">
          {!activeProject ? (
            <>
              <div className="sb-form">
                <InputField id="sb-name" label="프로젝트명" value={name} onChange={onNameChange} placeholder="프로젝트명" />
                <InputField id="sb-domain" label="도메인" value={domain} onChange={onDomainChange} placeholder="https://..." />
                <div className="field-group">
                  <label className="field-label">작업 폴더</label>
                  <div className="sb-picker-row">
                    <input className="text-input" value={workingPath} readOnly placeholder="선택한 폴더명" />
                    <button className="button ghost" type="button" onClick={() => folderInputRef.current?.click()}>
                      찾아보기
                    </button>
                  </div>
                  <input
                    ref={folderInputRef}
                    type="file"
                    hidden
                    multiple
                    onChange={handleFolderSelection}
                    {...({ webkitdirectory: "" } as Record<string, string>)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">참조 파일 추가</label>
                  <div className="sb-picker-row">
                    <input
                      className="text-input"
                      value={sourceFiles.length > 0 ? `${sourceFiles.length}개 파일 선택됨` : ""}
                      readOnly
                      placeholder="PDF, DOCX, TXT, HTML 등"
                    />
                    <button className="button ghost" type="button" onClick={() => fileInputRef.current?.click()}>
                      파일 추가
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" hidden multiple onChange={handleReferenceFileSelection} />
                  {sourceFiles.length > 0 ? (
                    <div className="sb-source-file-list">
                      {sourceFiles.slice(0, 4).map((file, index) => (
                        <div key={`${file.name}-${index}`} className="sb-source-file-chip">
                          <strong>{file.name}</strong>
                          <span>{file.relativePath || file.mimeType || "참조 파일"}</span>
                        </div>
                      ))}
                      {sourceFiles.length > 4 ? (
                        <span className="fine-print">외 {sourceFiles.length - 4}개 파일</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button className="button primary sb-btn-full" disabled={projectBusy || !name.trim()} onClick={onCreateProject}>
                  {projectBusy ? "생성 중…" : "프로젝트 생성"}
                </button>
              </div>
              {projects.length > 0 && (
                <details className="sb-subsection">
                  <summary className="sb-subsection-title">지난 프로젝트</summary>
                  <div className="sb-project-list">
                    {projects.map((p) => (
                      <button key={p.id} className="sb-project-item" onClick={() => onSelectProject(p.id)}>
                        <strong>{p.name}</strong>
                        <span className="fine-print">{p.domain || "도메인 없음"}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="sb-active-project">
              <strong>{activeProject.project.name}</strong>
              <span className="fine-print">{activeProject.project.domain || "도메인 없음"}</span>
              {isApproved && <span className="status-pill active">콘텍스트 승인됨</span>}
              <button className="button primary sb-btn-full" disabled={!isApproved || planBusy} onClick={onGenerateContentPlan}>
                {planBusy ? "계획 생성 중…" : contentPlan ? "월간 계획 다시 생성" : "월간 계획 생성"}
              </button>
              {!isApproved ? (
                <span className="fine-print">설정 화면에서 브랜드 컨텍스트를 먼저 저장하고 승인해야 콘텐츠 생성이 열립니다.</span>
              ) : null}
            </div>
          )}
        </div>
      </details>

      {/* ── 생성 ── */}
      {activeProject && (
        <details className="sb-section" open>
          <summary className="sb-section-title">콘텐츠 생성</summary>
          <div className="sb-section-body">
            <div className="sb-plan-card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <strong style={{ display: "block" }}>월간 마케팅 계획</strong>
                  <span className="fine-print">
                    {contentPlan ? `${contentPlan.monthKey} 계획` : "GA4와 승인된 콘텍스트를 바탕으로 이번 달 발행 계획을 만듭니다."}
                  </span>
                </div>
                <button className="button ghost" disabled={!isApproved || planBusy} onClick={onGenerateContentPlan}>
                  {planBusy ? "생성 중…" : contentPlan ? "다시 생성" : "계획 생성"}
                </button>
              </div>
              {!isApproved && (
                <div className="stack">
                  <p className="fine-print">월간 계획은 브랜드 콘텍스트 승인 후 생성할 수 있습니다.</p>
                  <a className="button ghost" href={activeProject ? `/studio/settings?projectId=${activeProject.project.id}` : "/studio/settings"}>
                    설정에서 컨텍스트 완료
                  </a>
                </div>
              )}
              {contentPlan?.basisSummary && (
                <p className="fine-print" style={{ marginTop: 8 }}>{contentPlan.basisSummary}</p>
              )}
              {contentPlan?.items?.length ? (
                <div className="sb-plan-list">
                  {contentPlan.items.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`sb-plan-item-button ${selectedPlannedTopicId === item.id ? "active" : ""}`}
                      onClick={() => onSelectPlannedTopic(item.id, item.topic)}
                    >
                      <strong>{item.weekLabel}</strong>
                      <span>{item.topic}</span>
                      <small>
                        {item.publishAt ? item.publishAt.slice(5, 10) : "일정 미정"} · {item.status}
                        {typeof item.attemptCount === "number" ? ` · 시도 ${item.attemptCount}회` : ""}
                      </small>
                      {item.lastError ? (
                        <small style={{ color: "#d64d49" }}>{item.lastError}</small>
                      ) : null}
                    </button>
                  ))}
                  {contentPlan.items.length > 3 ? (
                    <span className="fine-print">외 {contentPlan.items.length - 3}개 항목은 우측 보드에서 확인</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="field-group">
              <label className="field-label">토픽</label>
              <input
                className="text-input"
                value={topicInput}
                onChange={(e) => onTopicInputChange(e.target.value)}
                placeholder="생성할 콘텐츠의 테마를 입력하세요"
              />
            </div>
            <button className="button primary sb-btn-full" disabled={generateBusy || !topicInput.trim()} onClick={onGenerate}>
              {generateBusy ? "생성 중…" : "전체 생성"}
            </button>

            {/* SEO */}
            {seoCompliance && (
              <div className="sb-seo">
                <div className="seo-score-bar">
                  <div className="seo-score-fill" style={{ width: `${seoCompliance.score}%` }} />
                  <span className="seo-score-label">SEO {seoCompliance.score}점</span>
                </div>
              </div>
            )}

            {/* A/B */}
            {hasContent && (
              <div className="sb-ab-section">
                <span className="sb-sub-label">A/B 버전</span>
                <div className="button-row">
                  <button className="button ghost" disabled={abGenerateBusy || !topic} onClick={() => onGenerateVariants(2)}>
                    {abGenerateBusy ? "생성 중…" : "2개"}
                  </button>
                  <button className="button ghost" disabled={abGenerateBusy || !topic} onClick={() => onGenerateVariants(3)}>3개</button>
                </div>
                {adoptedVariant && (
                  <div className="sb-adopted-badge">
                    <span className="fine-print">채택: {adoptedVariant.variantLabel}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {/* ── 검증 ── */}
      {scores && (
        <details className="sb-section">
          <summary className="sb-section-title">검증</summary>
          <div className="sb-section-body">
            <div className="sb-scores">
              <div className="sb-score-row"><span>브랜드 정합</span><strong>{scores.brandAlignment}</strong></div>
              <div className="sb-score-row"><span>포맷 적합</span><strong>{scores.formatFit}</strong></div>
              <div className="sb-score-row"><span>CTA 명확도</span><strong>{scores.ctaClarity}</strong></div>
              <div className="sb-score-row"><span>리스크 제어</span><strong>{scores.riskControl}</strong></div>
              <div className="sb-score-row sb-score-total">
                <span>종합</span>
                <strong>{review?.status === "ready" ? "통과" : "수정 필요"}</strong>
              </div>
            </div>
          </div>
        </details>
      )}

      {/* ── 발행 ── */}
      {hasContent && (
        <details className="sb-section" open>
          <summary className="sb-section-title">발행 채널</summary>
          <div className="sb-section-body">
            <div className="sb-form">
              <div className="review-item">
                <strong>Blogger 설정은 전체 설정 메뉴에서 관리합니다.</strong>
                <p className="fine-print">
                  Blog ID, Access Token, 게시 상태와 자동화 정책은 설정 화면에 저장된 값을 그대로 사용합니다. 이 화면에서는 생성된 콘텐츠의 발행만 처리합니다.
                </p>
              </div>
              <div className="field-group">
                <label className="field-label">해시태그</label>
                {editingHashtags ? <div className="sb-hashtag-output">{editingHashtags}</div> : null}
                <div className="button-row">
                  <button
                    className="button ghost"
                    disabled={hashtagBusy}
                    onClick={onGenerateHashtags}
                  >
                    {hashtagBusy ? "생성 중…" : "자동 생성"}
                  </button>
                </div>
                <input
                  className="text-input"
                  value={editingHashtags}
                  onChange={(e) => onEditingHashtagsChange(e.target.value)}
                  placeholder="#키워드1 #키워드2"
                />
              </div>
              <div className="button-row">
                <button className="button primary" disabled={publishBusy} onClick={onPreparePublish}>
                  {publishBusy ? "처리 중…" : publishPackage ? "Blogger 발행" : "발행 준비"}
                </button>
              </div>
              <button className="button ghost sb-btn-full" disabled={exportBusy} onClick={onExportAll}>
                {exportBusy ? "내보내기 중…" : "전체 JSON 내보내기"}
              </button>
            </div>
          </div>
        </details>
      )}

      {activeProject && (
        <details className="sb-section">
          <summary className="sb-section-title">자동화 운영</summary>
          <OperationsBoard
            projectId={activeProject.project.id}
            contentPlan={contentPlan}
            publications={publications}
            failedPublications={failedPublications}
            publishedPublications={publishedPublications}
            readiness={readiness}
            automationBusy={automationBusy}
                automationRun={automationRun}
                automationFeedback={automationFeedback}
                publicationFeedback={publicationFeedback}
                bulkReport={bulkReport}
                bulkReportHistory={bulkReportHistory}
                reviewQueue={reviewQueue}
            readyQueue={readyQueue}
            failedQueue={failedQueue}
            publishedQueue={publishedQueue}
            onRunAutomation={onRunAutomation}
            onApproveReview={onApproveReview}
            onRetryPlanItem={onRetryPlanItem}
            onRetryPublication={onRetryPublication}
            onBulkApproveReview={onBulkApproveReview}
            onBulkRetryPlanItems={onBulkRetryPlanItems}
            onBulkRetryPublications={onBulkRetryPublications}
          />
        </details>
      )}
    </aside>
  );
}
