"use client";

import { useEffect } from "react";
import { usePipelineState } from "./hooks/use-pipeline-state";
import { useSourceRegistration } from "./hooks/use-source-registration";
import { useContentGeneration } from "./hooks/use-content-generation";
import { useAbTesting } from "./hooks/use-ab-testing";
import { usePublishWorkflow } from "./hooks/use-publish-workflow";
import { SourceRegistrationCard } from "./sections/source-registration-card";
import { ContentGenerationCard } from "./sections/content-generation-card";
import { AbTestingCard } from "./sections/ab-testing-card";
import { VerifyPublishCard } from "./sections/verify-publish-card";
import type { ProjectDetail } from "./types";

export function PipelineShell() {
  const state = usePipelineState();

  const source = useSourceRegistration({
    onProjectCreated: (project: ProjectDetail) => {
      state.setActiveProject(project);
      state.loadProjects();
      if (project.project?.id) {
        source.hydrateContextForm(project);
        state.loadStudio(project.project.id);
      }
    },
    onError: state.setError,
  });

  const content = useContentGeneration({
    onStudioUpdate: (studio) => {
      state.setStudio(studio);
      content.hydrateEditor(studio);
    },
    onError: state.setError,
  });

  const ab = useAbTesting({
    onVariantGroupUpdate: state.setVariantGroup,
    onStudioUpdate: state.setStudio,
    onError: state.setError,
  });

  const publish = usePublishWorkflow({
    projectId: state.activeProject?.project?.id,
    onError: state.setError,
    reloadProject: async (projectId: string) => {
      await state.reloadProject(projectId);
    },
  });

  // Initial load
  useEffect(() => {
    state.loadProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When project changes, hydrate context and load studio
  useEffect(() => {
    if (state.activeProject) {
      source.hydrateContextForm(state.activeProject);
      publish.hydratePublishResult(state.activeProject);
    }
  }, [state.activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // When studio loads, hydrate editor + load variants
  useEffect(() => {
    if (state.studio) {
      content.hydrateEditor(state.studio);
      if (state.activeProject?.project?.id) {
        ab.loadVariantGroup(state.activeProject.project.id);
      }
    }
  }, [state.studio]); // eslint-disable-line react-hooks/exhaustive-deps

  const projectId = state.activeProject?.project?.id;
  const topic = state.studio?.draft?.topic || "";

  return (
    <div className="app-shell">
      <div className="pipeline-frame">
        {/* Header */}
        <header className="pipeline-header">
          <div className="rule" />
          <span className="eyebrow">M-MASTER PIPELINE</span>
          <h1 className="brand-title">콘텐츠 파이프라인</h1>
          <p className="brand-copy">블로그 → 파생 채널 → A/B 비교 → 검증 · 발행</p>
        </header>

        {/* Error */}
        {state.error && (
          <div className="pipeline-error">
            <p className="error-text">{state.error}</p>
            <button className="button ghost" onClick={state.clearError}>닫기</button>
          </div>
        )}

        {/* Section 1: Source Registration */}
        <SourceRegistrationCard
          locked={state.sectionLock.source}
          projects={state.projects}
          activeProject={state.activeProject}
          name={source.name}
          onNameChange={source.setName}
          domain={source.domain}
          onDomainChange={source.setDomain}
          industry={source.industry}
          onIndustryChange={source.setIndustry}
          workingPath={source.workingPath}
          onWorkingPathChange={source.setWorkingPath}
          busy={source.busy}
          onCreateProject={source.handleCreateProject}
          onSelectProject={(id) => {
            state.loadProject(id);
            state.loadStudio(id);
          }}
          editingSummary={source.editingSummary}
          onEditingSummaryChange={source.setEditingSummary}
          editingAudience={source.editingAudience}
          onEditingAudienceChange={source.setEditingAudience}
          editingTone={source.editingTone}
          onEditingToneChange={source.setEditingTone}
          editingCta={source.editingCta}
          onEditingCtaChange={source.setEditingCta}
          editingBannedTerms={source.editingBannedTerms}
          onEditingBannedTermsChange={source.setEditingBannedTerms}
          contextBusy={source.contextBusy}
          onApproveContext={() => projectId && source.handleApproveContext(projectId)}
          onSaveContextDraft={() => projectId && source.handleSaveContextDraft(projectId)}
        />

        {/* Section 2: Content Generation */}
        <ContentGenerationCard
          locked={state.sectionLock.generation}
          studio={state.studio}
          topics={state.studio?.topics || state.activeProject?.topics || []}
          selectedTopicId={content.selectedTopicId}
          onSelectTopic={content.setSelectedTopicId}
          generateBusy={content.generateBusy}
          onGenerate={() => {
            if (projectId) {
              content.handleGenerate(projectId, content.selectedTopicId || undefined);
            }
          }}
          seoCompliance={content.seoCompliance}
          activeChannel={content.activeChannel}
          onChannelChange={content.setActiveChannel}
          editingTitle={content.editingTitle}
          onEditingTitleChange={content.setEditingTitle}
          editingBody={content.editingBody}
          onEditingBodyChange={content.setEditingBody}
          editingCta={content.editingCta}
          onEditingCtaChange={content.setEditingCta}
          editingHashtags={content.editingHashtags}
          onEditingHashtagsChange={content.setEditingHashtags}
          onUpdateSeo={content.updateSeoFromEditor}
          saveBusy={content.saveBusy}
          onSave={() => {
            if (projectId && state.studio) {
              content.handleSave(projectId, state.studio);
            }
          }}
        />

        {/* Section 3: A/B Testing */}
        <AbTestingCard
          locked={state.sectionLock.ab}
          topic={topic}
          variantGroup={state.variantGroup}
          generateBusy={ab.generateBusy}
          adoptBusy={ab.adoptBusy}
          onGenerateVariants={(count) => {
            if (projectId) ab.handleGenerateVariants(projectId, topic, count);
          }}
          onAdoptVariant={(id) => {
            if (projectId) ab.handleAdoptVariant(projectId, id);
          }}
        />

        {/* Section 4: Verify & Publish */}
        <VerifyPublishCard
          locked={state.sectionLock.verify}
          studio={state.studio}
          exportBusy={publish.exportBusy}
          exportPreview={publish.exportPreview}
          onExportChannel={publish.handleExportChannel}
          onExportAll={publish.handleExportAll}
          onCopyExportPreview={publish.handleCopyExportPreview}
          onDownloadExportContent={publish.handleDownloadExportContent}
          onDownloadExportHashtags={publish.handleDownloadExportHashtags}
          onExportPreviewViewChange={publish.handleExportPreviewViewChange}
          copyBusy={publish.copyBusy}
          copyStatus={publish.copyStatus}
          publishBusy={publish.publishBusy}
          publishPackage={publish.publishPackage}
          publishDraft={publish.publishDraft}
          onPublishDraftChange={publish.handlePublishDraftChange}
          onCopyBlogPublishHtml={publish.handleCopyBlogPublishHtml}
          onPreparePublish={publish.handlePreparePublish}
          wordpressResult={publish.wordpressResult}
          wordpressConfig={publish.wordpressConfig}
          onWordPressConfigChange={publish.handleWordPressConfigChange}
          settingsBusy={publish.settingsBusy}
          onSaveWordPressDefaults={publish.handleSaveWordPressDefaults}
        />

        {/* Progress bar */}
        <div className="pipeline-progress">
          <div className="pipeline-progress-track">
            <div className={`pipeline-progress-node ${!state.sectionLock.source ? "done" : ""}`}>소스</div>
            <div className={`pipeline-progress-node ${state.activeProject?.brandProfile?.approved ? "done" : ""}`}>콘텍스트</div>
            <div className={`pipeline-progress-node ${(state.studio?.draft?.assets?.length ?? 0) > 0 ? "done" : ""}`}>콘텐츠</div>
            <div className={`pipeline-progress-node ${state.variantGroup?.variants?.some(v => v.adopted) ? "done" : ""}`}>A/B</div>
            <div className={`pipeline-progress-node ${state.studio?.review?.status === "ready" ? "done" : ""}`}>검증</div>
          </div>
        </div>
      </div>
    </div>
  );
}
