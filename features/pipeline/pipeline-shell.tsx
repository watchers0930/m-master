"use client";

import { useEffect } from "react";
import { AppHeader } from "@/features/site/app-header";
import { usePipelineState } from "./hooks/use-pipeline-state";
import { useSourceRegistration } from "./hooks/use-source-registration";
import { useContentGeneration } from "./hooks/use-content-generation";
import { useAbTesting } from "./hooks/use-ab-testing";
import { usePublishWorkflow } from "./hooks/use-publish-workflow";
import { useImageStudio } from "./hooks/use-image-studio";
import { SidebarPanel } from "./sections/sidebar-panel";
import { ContentPanel } from "./sections/content-panel";
import { ImagePanel } from "./sections/image-panel";
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
      images.hydrateFromStudio(studio);
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

  const images = useImageStudio({
    onStudioUpdate: (studio) => {
      state.setStudio(studio);
    },
    onError: state.setError,
  });

  // Initial load
  useEffect(() => {
    state.loadProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When project changes
  useEffect(() => {
    if (state.activeProject) {
      source.hydrateContextForm(state.activeProject);
      publish.hydratePublishResult(state.activeProject);
    }
  }, [state.activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // When studio loads
  useEffect(() => {
    if (state.studio) {
      content.hydrateEditor(state.studio);
      images.hydrateFromStudio(state.studio);
      if (state.activeProject?.project?.id) {
        ab.loadVariantGroup(state.activeProject.project.id);
      }
    }
  }, [state.studio]); // eslint-disable-line react-hooks/exhaustive-deps

  const projectId = state.activeProject?.project?.id;
  const topic = state.studio?.draft?.topic || "";
  const hasContent = (state.studio?.draft?.assets?.length ?? 0) > 0;

  return (
    <div className="app-shell">
      <AppHeader active="content" />

      {/* Error */}
      {state.error && (
        <div className="pipeline-error">
          <p className="error-text">{state.error}</p>
          <button className="button ghost" onClick={state.clearError}>닫기</button>
        </div>
      )}

      {/* 3-column layout */}
      <div className="pipeline-grid">
        {/* Left: Sidebar controls */}
        <SidebarPanel
          projects={state.projects}
          activeProject={state.activeProject}
          name={source.name}
          onNameChange={source.setName}
          domain={source.domain}
          onDomainChange={source.setDomain}
          workingPath={source.workingPath}
          onWorkingPathChange={source.setWorkingPath}
          projectBusy={source.busy}
          onCreateProject={source.handleCreateProject}
          onSelectProject={(id) => { state.loadProject(id); state.loadStudio(id); }}
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
          topicInput={content.topicInput}
          onTopicInputChange={content.setTopicInput}
          generateBusy={content.generateBusy}
          onGenerate={() => { if (projectId) content.handleGenerate(projectId, undefined, content.topicInput.trim() || undefined); }}
          topic={topic}
          variantGroup={state.variantGroup}
          abGenerateBusy={ab.generateBusy}
          onGenerateVariants={(count) => { if (projectId) ab.handleGenerateVariants(projectId, topic, count); }}
          adoptBusy={ab.adoptBusy}
          onAdoptVariant={(id) => { if (projectId) ab.handleAdoptVariant(projectId, id); }}
          seoCompliance={content.seoCompliance}
          studio={state.studio}
          exportBusy={publish.exportBusy}
          onExportAll={publish.handleExportAll}
          publishBusy={publish.publishBusy}
          publishPackage={publish.publishPackage}
          onPreparePublish={publish.handlePreparePublish}
          wordpressConfig={publish.wordpressConfig}
          onWordPressConfigChange={publish.handleWordPressConfigChange}
          editingHashtags={content.editingHashtags}
          onEditingHashtagsChange={content.setEditingHashtags}
          hashtagBusy={content.hashtagBusy}
          onGenerateHashtags={content.handleGenerateHashtags}
          settingsBusy={publish.settingsBusy}
          onSaveWordPressDefaults={publish.handleSaveWordPressDefaults}
        />

        {/* Center: Content preview */}
        <ContentPanel
          studio={state.studio}
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
          seoCompliance={content.seoCompliance}
          saveBusy={content.saveBusy}
          onSave={() => { if (projectId && state.studio) content.handleSave(projectId, state.studio); }}
          variantGroup={state.variantGroup}
          adoptBusy={ab.adoptBusy}
          onAdoptVariant={(id) => { if (projectId) ab.handleAdoptVariant(projectId, id); }}
          exportPreview={publish.exportPreview}
          onExportChannel={publish.handleExportChannel}
          onExportPreviewViewChange={publish.handleExportPreviewViewChange}
          onCopyExportPreview={publish.handleCopyExportPreview}
          copyBusy={publish.copyBusy}
          copyStatus={publish.copyStatus}
        />

        {/* Right: Image preview */}
        <ImagePanel
          projectId={projectId}
          activeChannel={images.activeChannel}
          onChannelChange={images.setActiveChannel}
          currentStudio={images.currentStudio}
          generateBusy={images.generateBusy}
          selectBusy={images.selectBusy}
          onGenerateImages={images.handleGenerateImages}
          onSelectImage={images.handleSelectImage}
          hasContent={hasContent}
        />
      </div>
    </div>
  );
}
