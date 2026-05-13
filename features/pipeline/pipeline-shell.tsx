"use client";

import { useEffect, useEffectEvent } from "react";
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
      source.hydrateContextForm(project);
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

  const syncProjectUi = useEffectEvent((project: ProjectDetail) => {
    source.hydrateContextForm(project);
    publish.hydratePublishResult(project);
  });

  const syncStudioUi = useEffectEvent((projectId: string | undefined, studio: NonNullable<typeof state.studio>) => {
    content.hydrateEditor(studio);
    images.hydrateFromStudio(studio);
    if (projectId) {
      ab.loadVariantGroup(projectId);
    }
  });

  useEffect(() => {
    if (state.activeProject) {
      syncProjectUi(state.activeProject);
    }
  }, [state.activeProject, syncProjectUi]);

  useEffect(() => {
    if (state.studio) {
      syncStudioUi(state.activeProject?.project?.id, state.studio);
    }
  }, [state.activeProject?.project?.id, state.studio, syncStudioUi]);

  const projectId = state.activeProject?.project?.id;
  const topic = content.topicInput.trim() || state.studio?.draft?.topic || "";
  const hasContent = (state.studio?.draft?.assets?.length ?? 0) > 0;
  const visibleError = state.error === "프로젝트 목록을 불러오지 못했습니다." ? "" : state.error;
  const blogAsset = state.studio?.draft?.assets?.find((asset) => asset.channel === "blog");
  const blogImageCueCount = (blogAsset?.body.match(/\[이미지\s+\d+\]/g) || []).length;
  const expectedImageVariantCount =
    images.activeChannel === "blog" ? Math.min(5, Math.max(3, blogImageCueCount || 3)) : 3;
  const syncContextBeforeGeneration = async () => {
    if (!projectId || !source.editingSummary.trim()) {
      return;
    }
    await source.handleApproveContext(projectId);
  };

  const sidebarProps = {
    project: {
      activeProject: state.activeProject,
      name: source.name,
      onNameChange: source.setName,
      domain: source.domain,
      onDomainChange: source.setDomain,
      workingPath: source.workingPath,
      onWorkingPathChange: source.setWorkingPath,
      projectBusy: source.busy,
      onCreateProject: source.handleCreateProject,
    },
    context: {
      editingSummary: source.editingSummary,
      onEditingSummaryChange: source.setEditingSummary,
      editingAudience: source.editingAudience,
      onEditingAudienceChange: source.setEditingAudience,
      editingTone: source.editingTone,
      onEditingToneChange: source.setEditingTone,
      onTonePresetSelect: (tone: string) => {
        source.setEditingTone(tone);
        if (projectId) {
          void source.handleSaveContextDraftWithOverrides(projectId, { tone });
        }
      },
      editingCta: source.editingCta,
      onEditingCtaChange: source.setEditingCta,
      editingBannedTerms: source.editingBannedTerms,
      onEditingBannedTermsChange: source.setEditingBannedTerms,
      contextBusy: source.contextBusy,
      onApproveContext: () => {
        if (projectId) {
          source.handleApproveContext(projectId);
        }
      },
      onSaveContextDraft: () => {
        if (projectId) {
          source.handleSaveContextDraft(projectId);
        }
      },
    },
    generation: {
      topicInput: content.topicInput,
      onTopicInputChange: content.setTopicInput,
      generateBusy: content.generateBusy,
      onGenerate: async () => {
        if (projectId) {
          const requestedTopic = content.topicInput.trim();
          await syncContextBeforeGeneration();
          content.handleGenerate(projectId, undefined, requestedTopic || undefined);
        }
      },
      seoCompliance: content.seoCompliance,
    },
    abTesting: {
      topic,
      variantGroup: state.variantGroup,
      abGenerateBusy: ab.generateBusy,
      onGenerateVariants: (count: number) => {
        if (projectId) {
          ab.handleGenerateVariants(projectId, topic, count);
        }
      },
      adoptBusy: ab.adoptBusy,
      onAdoptVariant: (id: string) => {
        if (projectId) {
          ab.handleAdoptVariant(projectId, id);
        }
      },
    },
    publish: {
      exportBusy: publish.exportBusy,
      onExportAll: publish.handleExportAll,
      publishBusy: publish.publishBusy,
      publishPackage: publish.publishPackage,
      onPreparePublish: publish.handlePreparePublish,
      wordpressConfig: publish.wordpressConfig,
      onWordPressConfigChange: publish.handleWordPressConfigChange,
      settingsBusy: publish.settingsBusy,
      onSaveWordPressDefaults: publish.handleSaveWordPressDefaults,
    },
    studio: {
      studio: state.studio,
      editingHashtags: content.editingHashtags,
      onEditingHashtagsChange: content.setEditingHashtags,
      hashtagBusy: content.hashtagBusy,
      onGenerateHashtags: content.handleGenerateHashtags,
    },
  };

  return (
    <div className="app-shell">
      <AppHeader active="content" />

      {visibleError && (
        <div className="pipeline-error">
          <p className="error-text">{visibleError}</p>
          <button className="button ghost" onClick={state.clearError}>닫기</button>
        </div>
      )}

      <div className="pipeline-grid">
        <SidebarPanel
          projects={state.projects}
          activeProject={sidebarProps.project.activeProject}
          name={sidebarProps.project.name}
          onNameChange={sidebarProps.project.onNameChange}
          domain={sidebarProps.project.domain}
          onDomainChange={sidebarProps.project.onDomainChange}
          workingPath={sidebarProps.project.workingPath}
          onWorkingPathChange={sidebarProps.project.onWorkingPathChange}
          projectBusy={sidebarProps.project.projectBusy}
          onCreateProject={sidebarProps.project.onCreateProject}
          onSelectProject={(id) => state.loadProject(id)}
          editingSummary={sidebarProps.context.editingSummary}
          onEditingSummaryChange={sidebarProps.context.onEditingSummaryChange}
          editingAudience={sidebarProps.context.editingAudience}
          onEditingAudienceChange={sidebarProps.context.onEditingAudienceChange}
          editingTone={sidebarProps.context.editingTone}
          onEditingToneChange={sidebarProps.context.onEditingToneChange}
          editingCta={sidebarProps.context.editingCta}
          onEditingCtaChange={sidebarProps.context.onEditingCtaChange}
          editingBannedTerms={sidebarProps.context.editingBannedTerms}
          onEditingBannedTermsChange={sidebarProps.context.onEditingBannedTermsChange}
          contextBusy={sidebarProps.context.contextBusy}
          onApproveContext={sidebarProps.context.onApproveContext}
          onSaveContextDraft={sidebarProps.context.onSaveContextDraft}
          topicInput={sidebarProps.generation.topicInput}
          onTopicInputChange={sidebarProps.generation.onTopicInputChange}
          generateBusy={sidebarProps.generation.generateBusy}
          onGenerate={sidebarProps.generation.onGenerate}
          topic={sidebarProps.abTesting.topic}
          variantGroup={sidebarProps.abTesting.variantGroup}
          abGenerateBusy={sidebarProps.abTesting.abGenerateBusy}
          onGenerateVariants={sidebarProps.abTesting.onGenerateVariants}
          adoptBusy={sidebarProps.abTesting.adoptBusy}
          onAdoptVariant={sidebarProps.abTesting.onAdoptVariant}
          seoCompliance={sidebarProps.generation.seoCompliance}
          studio={sidebarProps.studio.studio}
          exportBusy={sidebarProps.publish.exportBusy}
          onExportAll={sidebarProps.publish.onExportAll}
          publishBusy={sidebarProps.publish.publishBusy}
          publishPackage={sidebarProps.publish.publishPackage}
          onPreparePublish={sidebarProps.publish.onPreparePublish}
          wordpressConfig={sidebarProps.publish.wordpressConfig}
          onWordPressConfigChange={sidebarProps.publish.onWordPressConfigChange}
          editingHashtags={sidebarProps.studio.editingHashtags}
          onEditingHashtagsChange={sidebarProps.studio.onEditingHashtagsChange}
          hashtagBusy={sidebarProps.studio.hashtagBusy}
          onGenerateHashtags={sidebarProps.studio.onGenerateHashtags}
          settingsBusy={sidebarProps.publish.settingsBusy}
          onSaveWordPressDefaults={sidebarProps.publish.onSaveWordPressDefaults}
        />

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
          onSave={() => {
            if (projectId && state.studio) {
              content.handleSave(projectId, state.studio);
            }
          }}
          variantGroup={state.variantGroup}
          adoptBusy={ab.adoptBusy}
          onAdoptVariant={(id) => {
            if (projectId) {
              ab.handleAdoptVariant(projectId, id);
            }
          }}
          exportPreview={publish.exportPreview}
          onExportChannel={publish.handleExportChannel}
          onExportPreviewViewChange={publish.handleExportPreviewViewChange}
          onCopyExportPreview={publish.handleCopyExportPreview}
          copyBusy={publish.copyBusy}
          copyStatus={publish.copyStatus}
        />

        <ImagePanel
          projectId={projectId}
          activeChannel={images.activeChannel}
          onChannelChange={images.setActiveChannel}
          currentStudio={images.currentStudio}
          generateBusy={images.generateBusy}
          selectBusy={images.selectBusy}
          onGenerateImages={() => {
            if (projectId) {
              images.handleGenerateImages(projectId, expectedImageVariantCount);
            }
          }}
          onSelectImage={(imageAssetId) => {
            if (projectId) {
              images.handleSelectImage(projectId, imageAssetId);
            }
          }}
          hasContent={hasContent}
        />
      </div>
    </div>
  );
}
