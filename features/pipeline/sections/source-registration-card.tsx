"use client";

import { useEffect } from "react";
import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import { SectionLockOverlay } from "../components/section-lock-overlay";
import type { ProjectDetail, ProjectListItem, EditableBrandProfileField } from "../types";

type Props = {
  locked: boolean;
  projects: ProjectListItem[];
  activeProject: ProjectDetail | null;
  // Registration
  name: string;
  onNameChange: (v: string) => void;
  domain: string;
  onDomainChange: (v: string) => void;
  industry: string;
  onIndustryChange: (v: string) => void;
  workingPath: string;
  onWorkingPathChange: (v: string) => void;
  busy: boolean;
  onCreateProject: () => void;
  onSelectProject: (projectId: string) => void;
  // Context editing
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
};

export function SourceRegistrationCard(props: Props) {
  const {
    locked, projects, activeProject,
    name, onNameChange, domain, onDomainChange,
    industry, onIndustryChange, workingPath, onWorkingPathChange,
    busy, onCreateProject, onSelectProject,
    editingSummary, onEditingSummaryChange,
    editingAudience, onEditingAudienceChange,
    editingTone, onEditingToneChange,
    editingCta, onEditingCtaChange,
    editingBannedTerms, onEditingBannedTermsChange,
    contextBusy, onApproveContext, onSaveContextDraft,
  } = props;

  const bp = activeProject?.brandProfile;
  const isApproved = bp?.approved === true;

  return (
    <div className="pipeline-section">
      <SectionCard title="소스 등록" description="프로젝트 등록 및 브랜드 콘텍스트 확인">
        {locked && <SectionLockOverlay />}

        {!activeProject ? (
          <div className="wizard-stage">
            {/* Existing project list */}
            {projects.length > 0 && (
              <div className="stack">
                <p className="field-label">기존 프로젝트 선택</p>
                <div className="project-list">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      className="project-item-shell"
                      onClick={() => onSelectProject(p.id)}
                    >
                      <div className="project-item">
                        <strong>{p.name}</strong>
                        <span className="fine-print">{p.domain || "도메인 없음"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* New project form */}
            <div className="form-grid">
              <InputField id="project-name" label="프로젝트 이름" value={name} onChange={onNameChange} placeholder="예: 마이브랜드 블로그" />
              <InputField id="project-domain" label="도메인 (선택)" value={domain} onChange={onDomainChange} placeholder="https://example.com" />
              <InputField id="project-industry" label="업종 (선택)" value={industry} onChange={onIndustryChange} placeholder="real-estate, marketing, saas..." />
              <InputField id="project-path" label="작업 폴더 (선택)" value={workingPath} onChange={onWorkingPathChange} placeholder="/path/to/project" />
              <button className="button primary" disabled={busy || !name.trim()} onClick={onCreateProject}>
                {busy ? "프로젝트 생성 중…" : "프로젝트 생성"}
              </button>
            </div>
          </div>
        ) : (
          <div className="wizard-stage">
            {/* Project info */}
            <div className="step-focus-banner">
              <span className="eyebrow">등록된 프로젝트</span>
              <h3 className="card-title" style={{ marginTop: 6 }}>{activeProject.project.name}</h3>
              <p className="fine-print">
                {activeProject.project.domain || "도메인 없음"} · {activeProject.project.industry || "일반"}
              </p>
            </div>

            {/* Context editing */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">브랜드 콘텍스트</h3>
                  <p className="card-copy">AI가 분석한 브랜드 맥락을 확인하고 승인합니다.</p>
                </div>
                {isApproved && <span className="status-pill active">승인됨</span>}
              </div>

              <div className="form-grid">
                <div className="field-group">
                  <label className="field-label">요약</label>
                  <textarea
                    className="text-area"
                    value={editingSummary}
                    onChange={(e) => onEditingSummaryChange(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="field-grid-2">
                  <div className="field-group">
                    <label className="field-label">타겟 독자</label>
                    <input className="text-input" value={editingAudience} onChange={(e) => onEditingAudienceChange(e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">톤</label>
                    <input className="text-input" value={editingTone} onChange={(e) => onEditingToneChange(e.target.value)} />
                  </div>
                </div>
                <div className="field-group">
                  <label className="field-label">CTA 방향</label>
                  <input className="text-input" value={editingCta} onChange={(e) => onEditingCtaChange(e.target.value)} />
                </div>
                <div className="field-group">
                  <label className="field-label">금지 표현</label>
                  <input className="text-input" value={editingBannedTerms} onChange={(e) => onEditingBannedTermsChange(e.target.value)} placeholder="쉼표로 구분" />
                </div>
              </div>

              <div className="button-row" style={{ marginTop: 16 }}>
                <button
                  className="button primary"
                  disabled={contextBusy || !editingSummary.trim()}
                  onClick={onApproveContext}
                >
                  {contextBusy ? "처리 중…" : isApproved ? "재승인" : "승인"}
                </button>
                <button
                  className="button ghost"
                  disabled={contextBusy}
                  onClick={onSaveContextDraft}
                >
                  임시 저장
                </button>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
