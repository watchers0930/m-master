"use client";

import { InputField } from "@/components/ui/input-field";
import type {
  ProjectListItem,
  ProjectDetail,
  SeoComplianceResult,
  VariantGroup,
  StudioDetail,
  WordPressPublishConfig,
  BlogPublishPackage,
} from "../types";

type Props = {
  /* Project */
  projects: ProjectListItem[];
  activeProject: ProjectDetail | null;
  name: string;
  onNameChange: (v: string) => void;
  domain: string;
  onDomainChange: (v: string) => void;
  industry: string;
  onIndustryChange: (v: string) => void;
  workingPath: string;
  onWorkingPathChange: (v: string) => void;
  projectBusy: boolean;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  /* Context */
  editingSummary: string;
  onEditingSummaryChange: (v: string) => void;
  editingAudience: string;
  onEditingAudienceChange: (v: string) => void;
  editingTone: string;
  onEditingToneChange: (v: string) => void;
  editingCta: string;
  onEditingCtaChange: (v: string) => void;
  editingBannedTerms: string;
  onEditingBannedTermsChange: (v: string) => void;
  contextBusy: boolean;
  onApproveContext: () => void;
  onSaveContextDraft: () => void;
  /* Generation */
  topics: Array<{ id: string; title: string; score?: number | null }>;
  selectedTopicId: string | null;
  onSelectTopic: (id: string) => void;
  generateBusy: boolean;
  onGenerate: () => void;
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
  /* Publish */
  exportBusy: boolean;
  onExportAll: () => void;
  publishBusy: boolean;
  publishPackage: BlogPublishPackage | null;
  onPreparePublish: () => void;
  wordpressConfig: WordPressPublishConfig;
  onWordPressConfigChange: (field: keyof WordPressPublishConfig, value: string) => void;
  settingsBusy: boolean;
  onSaveWordPressDefaults: () => void;
};

export function SidebarPanel(props: Props) {
  const {
    projects, activeProject,
    name, onNameChange, domain, onDomainChange,
    industry, onIndustryChange, workingPath, onWorkingPathChange,
    projectBusy, onCreateProject, onSelectProject,
    editingSummary, onEditingSummaryChange,
    editingAudience, onEditingAudienceChange,
    editingTone, onEditingToneChange,
    editingCta, onEditingCtaChange,
    editingBannedTerms, onEditingBannedTermsChange,
    contextBusy, onApproveContext, onSaveContextDraft,
    topics, selectedTopicId, onSelectTopic,
    generateBusy, onGenerate,
    topic, variantGroup, abGenerateBusy, onGenerateVariants, adoptBusy, onAdoptVariant,
    seoCompliance,
    studio,
    exportBusy, onExportAll,
    publishBusy, publishPackage, onPreparePublish,
    wordpressConfig, onWordPressConfigChange,
    settingsBusy, onSaveWordPressDefaults,
  } = props;

  const bp = activeProject?.brandProfile;
  const isApproved = bp?.approved === true;
  const review = studio?.review;
  const scores = review?.scores;
  const hasContent = (studio?.draft?.assets?.length ?? 0) > 0;
  const adoptedVariant = variantGroup?.variants?.find((v) => v.adopted);

  return (
    <aside className="sidebar-panel">
      {/* ── 프로젝트 ── */}
      <details className="sb-section" open>
        <summary className="sb-section-title">프로젝트</summary>
        <div className="sb-section-body">
          {!activeProject ? (
            <>
              {projects.length > 0 && (
                <div className="sb-project-list">
                  {projects.map((p) => (
                    <button key={p.id} className="sb-project-item" onClick={() => onSelectProject(p.id)}>
                      <strong>{p.name}</strong>
                      <span className="fine-print">{p.domain || "도메인 없음"}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="sb-form">
                <InputField id="sb-name" label="이름" value={name} onChange={onNameChange} placeholder="프로젝트 이름" />
                <InputField id="sb-domain" label="도메인" value={domain} onChange={onDomainChange} placeholder="https://..." />
                <InputField id="sb-industry" label="업종" value={industry} onChange={onIndustryChange} placeholder="예: SaaS" />
                <InputField id="sb-path" label="작업 폴더" value={workingPath} onChange={onWorkingPathChange} placeholder="/path" />
                <button className="button primary sb-btn-full" disabled={projectBusy || !name.trim()} onClick={onCreateProject}>
                  {projectBusy ? "생성 중…" : "프로젝트 생성"}
                </button>
              </div>
            </>
          ) : (
            <div className="sb-active-project">
              <strong>{activeProject.project.name}</strong>
              <span className="fine-print">{activeProject.project.domain || "도메인 없음"}</span>
              {isApproved && <span className="status-pill active">콘텍스트 승인됨</span>}
            </div>
          )}
        </div>
      </details>

      {/* ── 콘텍스트 ── */}
      {activeProject && (
        <details className="sb-section" open={!isApproved}>
          <summary className="sb-section-title">브랜드 콘텍스트</summary>
          <div className="sb-section-body">
            <div className="sb-form">
              <div className="field-group">
                <label className="field-label">요약</label>
                <textarea className="text-area sb-textarea" value={editingSummary} onChange={(e) => onEditingSummaryChange(e.target.value)} rows={2} />
              </div>
              <div className="field-group">
                <label className="field-label">타겟 독자</label>
                <input className="text-input" value={editingAudience} onChange={(e) => onEditingAudienceChange(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">톤</label>
                <input className="text-input" value={editingTone} onChange={(e) => onEditingToneChange(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">CTA</label>
                <input className="text-input" value={editingCta} onChange={(e) => onEditingCtaChange(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">금지 표현</label>
                <input className="text-input" value={editingBannedTerms} onChange={(e) => onEditingBannedTermsChange(e.target.value)} placeholder="쉼표 구분" />
              </div>
              <div className="button-row">
                <button className="button primary" disabled={contextBusy || !editingSummary.trim()} onClick={onApproveContext}>
                  {contextBusy ? "처리 중…" : isApproved ? "재승인" : "승인"}
                </button>
                <button className="button ghost" disabled={contextBusy} onClick={onSaveContextDraft}>임시 저장</button>
              </div>
            </div>
          </div>
        </details>
      )}

      {/* ── 생성 ── */}
      {isApproved && (
        <details className="sb-section" open>
          <summary className="sb-section-title">콘텐츠 생성</summary>
          <div className="sb-section-body">
            {topics.length > 0 && (
              <div className="sb-topic-list">
                {topics.map((t) => (
                  <button
                    key={t.id}
                    className={`sb-topic-chip ${selectedTopicId === t.id ? "active" : ""}`}
                    onClick={() => onSelectTopic(t.id)}
                  >
                    {t.title}
                    {t.score != null && <span className="fine-print">{t.score}점</span>}
                  </button>
                ))}
              </div>
            )}
            <button className="button primary sb-btn-full" disabled={generateBusy} onClick={onGenerate}>
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
        <details className="sb-section" open>
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
        <details className="sb-section">
          <summary className="sb-section-title">발행</summary>
          <div className="sb-section-body">
            <div className="sb-form">
              <div className="field-group">
                <label className="field-label">WP 사이트 URL</label>
                <input className="text-input" value={wordpressConfig.siteUrl} onChange={(e) => onWordPressConfigChange("siteUrl", e.target.value)} placeholder="https://your-site.com" />
              </div>
              <div className="field-group">
                <label className="field-label">사용자명</label>
                <input className="text-input" value={wordpressConfig.username} onChange={(e) => onWordPressConfigChange("username", e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">앱 비밀번호</label>
                <input className="text-input" type="password" value={wordpressConfig.appPassword} onChange={(e) => onWordPressConfigChange("appPassword", e.target.value)} />
              </div>
              <div className="button-row">
                <button className="button primary" disabled={publishBusy} onClick={onPreparePublish}>
                  {publishBusy ? "처리 중…" : publishPackage ? "WP 발행" : "발행 준비"}
                </button>
                <button className="button ghost" disabled={settingsBusy} onClick={onSaveWordPressDefaults}>
                  {settingsBusy ? "저장 중…" : "설정 저장"}
                </button>
              </div>
              <button className="button ghost sb-btn-full" disabled={exportBusy} onClick={onExportAll}>
                {exportBusy ? "내보내기 중…" : "전체 JSON 내보내기"}
              </button>
            </div>
          </div>
        </details>
      )}
    </aside>
  );
}
