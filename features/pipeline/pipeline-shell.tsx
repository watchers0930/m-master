"use client";

import { useEffect, useEffectEvent } from "react";
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

  // When project changes
  useEffect(() => {
    if (state.activeProject) {
      syncProjectUi(state.activeProject);
    }
  }, [state.activeProject, syncProjectUi]);

  // When studio loads
  useEffect(() => {
    if (state.studio) {
      syncStudioUi(state.activeProject?.project?.id, state.studio);
    }
  }, [state.activeProject?.project?.id, state.studio, syncStudioUi]);

  const projectId = state.activeProject?.project?.id;
  const topic = content.topicInput.trim() || state.studio?.draft?.topic || "";
  const hasContent = (state.studio?.draft?.assets?.length ?? 0) > 0;
  const visibleError =
    state.error === "프로젝트 목록을 불러오지 못했습니다." ? "" : state.error;
  const blogAsset = state.studio?.draft?.assets?.find((asset) => asset.channel === "blog");
  const blogImageCueCount = (blogAsset?.body.match(/\[이미지\s+\d+\]/g) || []).length;
  const expectedImageVariantCount =
    images.activeChannel === "blog"
      ? Math.min(5, Math.max(3, blogImageCueCount || 3))
      : 3;
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
      adoptBusy: ab.adoptBusy,
      onGenerateVariants: async (count: number) => {
        if (projectId) {
          const requestedTopic = content.topicInput.trim() || topic;
          await syncContextBeforeGeneration();
          ab.handleGenerateVariants(projectId, requestedTopic, count);
        }
      },
      onAdoptVariant: (id: string) => {
        if (projectId) {
          ab.handleAdoptVariant(projectId, id);
        }
      },
    },
    review: {
      studio: state.studio,
    },
    hashtags: {
      editingHashtags: content.editingHashtags,
      onEditingHashtagsChange: content.setEditingHashtags,
      hashtagBusy: content.hashtagBusy,
      onGenerateHashtags: content.handleGenerateHashtags,
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
  };
  const contentPanelProps = {
    content: {
      studio: state.studio,
      activeChannel: content.activeChannel,
      onChannelChange: content.setActiveChannel,
      editingTitle: content.editingTitle,
      onEditingTitleChange: content.setEditingTitle,
      editingBody: content.editingBody,
      onEditingBodyChange: content.setEditingBody,
      editingCta: content.editingCta,
      onEditingCtaChange: content.setEditingCta,
      editingHashtags: content.editingHashtags,
      onEditingHashtagsChange: content.setEditingHashtags,
      onUpdateSeo: content.updateSeoFromEditor,
      seoCompliance: content.seoCompliance,
      saveBusy: content.saveBusy,
      onSave: () => {
        if (projectId && state.studio) {
          content.handleSave(projectId, state.studio);
        }
      },
    },
    variants: {
      topic,
      variantGroup: state.variantGroup,
      generateBusy: ab.generateBusy,
      adoptBusy: ab.adoptBusy,
      onGenerateVariants: (count: number) => {
        if (projectId) {
          const requestedTopic = content.topicInput.trim() || topic;
          void (async () => {
            await syncContextBeforeGeneration();
            ab.handleGenerateVariants(projectId, requestedTopic, count);
          })();
        }
      },
      onAdoptVariant: (id: string) => {
        if (projectId) {
          ab.handleAdoptVariant(projectId, id);
        }
      },
    },
    exportState: {
      exportPreview: publish.exportPreview,
      onExportPreviewViewChange: publish.handleExportPreviewViewChange,
      onCopyExportPreview: publish.handleCopyExportPreview,
      copyBusy: publish.copyBusy,
      copyStatus: publish.copyStatus,
    },
  };
  const imagePanelProps = {
    image: {
      projectId,
      activeChannel: images.activeChannel,
      onChannelChange: images.setActiveChannel,
      currentStudio: images.currentStudio,
      expectedVariantCount: expectedImageVariantCount,
      generateBusy: images.generateBusy,
      selectBusy: images.selectBusy,
      onGenerateImages: images.handleGenerateImages,
      onSelectImage: images.handleSelectImage,
      hasContent,
    },
  };

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="pipeline-header">
        <div className="pipeline-header-left">
          <div className="rule" />
          <span className="eyebrow">M-MASTER</span>
          <h1 className="brand-title">콘텐츠 파이프라인</h1>
        </div>
      </header>

      {/* Error */}
      {visibleError && (
        <div className="pipeline-error">
          <p className="error-text">{visibleError}</p>
          <button className="button ghost" onClick={state.clearError}>닫기</button>
        </div>
      )}

      {/* 3-column layout */}
      <div className="pipeline-grid">
        {/* Left: Sidebar controls */}
        <SidebarPanel {...sidebarProps} />

        {/* Center: Content preview */}
        <div className="pipeline-main-column">
          <ContentPanel {...contentPanelProps} />
          <div className="pipeline-mobile-image-panel">
            <ImagePanel {...imagePanelProps} />
          </div>
        </div>

        {/* Right: Image preview */}
        <div className="pipeline-desktop-image-panel">
          <ImagePanel {...imagePanelProps} />
        </div>
      </div>
    </div>
  );
}
