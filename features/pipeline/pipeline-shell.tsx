"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/features/site/app-header";
import { usePipelineState } from "./hooks/use-pipeline-state";
import { useSourceRegistration } from "./hooks/use-source-registration";
import { useContentGeneration } from "./hooks/use-content-generation";
import { useAbTesting } from "./hooks/use-ab-testing";
import { usePublishWorkflow } from "./hooks/use-publish-workflow";
import { useImageStudio } from "./hooks/use-image-studio";
import { apiPost } from "./hooks/use-api";
import { SidebarPanel } from "./sections/sidebar-panel";
import { ContentPanel } from "./sections/content-panel";
import { ImagePanel } from "./sections/image-panel";
import type { AutomationReviewResolution, AutomationRunSummary, BulkOperationReport, MonthlyContentPlan, ProjectDetail } from "./types";

export function PipelineShell() {
  const state = usePipelineState();
  const [planBusy, setPlanBusy] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationRun, setAutomationRun] = useState<AutomationRunSummary | null>(null);
  const [automationFeedback, setAutomationFeedback] = useState<AutomationReviewResolution | null>(null);
  const [publicationFeedback, setPublicationFeedback] = useState<string | null>(null);
  const [bulkReport, setBulkReport] = useState<BulkOperationReport | null>(null);

  const source = useSourceRegistration({
    onProjectCreated: (project: ProjectDetail) => {
      state.setActiveProject(project);
      state.loadProjects();
      if (project.project?.id) {
        source.hydrateContextForm(project);
        state.loadStudio(project.project.id);
        state.loadContentPlan(project.project.id);
        state.loadPublications(project.project.id);
        state.loadBulkOperationHistory(project.project.id);
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
  const reviewQueue = state.contentPlan?.items.filter((item) => item.status === "needs_review") || [];
  const readyQueue = state.contentPlan?.items.filter((item) => item.status === "ready_to_publish") || [];
  const failedQueue = state.contentPlan?.items.filter((item) => item.status === "failed") || [];
  const publishedQueue = state.contentPlan?.items.filter((item) => item.status === "published").slice(0, 5) || [];
  const failedPublications = state.publications.filter((publication) => publication.status === "failed").slice(0, 8);
  const publishedPublications = state.publications.filter((publication) => publication.status === "published").slice(0, 8);

  async function persistBulkReport(report: BulkOperationReport, durationMs: number) {
    if (!projectId) {
      return;
    }

    await apiPost<{ run: { id: string } }>(`/api/projects/${projectId}/automation-batch-runs`, {
      ...report,
      actorLabel: "operator",
      executionSource: "studio",
      durationMs,
    });
  }

  async function runBulkPlanAction(planItemIds: string[], action: "approve" | "retry") {
    if (!projectId || planItemIds.length === 0) {
      return;
    }

    setAutomationBusy(true);
    state.setError("");
    setPublicationFeedback(null);
    setBulkReport(null);

    try {
      const startedAt = Date.now();
      let completed = 0;
      let failed = 0;
      const items: BulkOperationReport["items"] = [];

      for (const planItemId of planItemIds) {
        try {
          const data = await apiPost<{ resolution: AutomationReviewResolution }>(`/api/projects/${projectId}/automation`, {
            action,
            planItemId,
            executionSource: "studio",
            skipAuditLog: true,
          });
          setAutomationFeedback(data.resolution);
          completed += 1;
          items.push({
            id: planItemId,
            label: data.resolution.planItemId,
            status: "success",
            message: data.resolution.message,
          });
        } catch (error) {
          failed += 1;
          items.push({
            id: planItemId,
            label: planItemId,
            status: "failed",
            message: error instanceof Error ? error.message : "처리에 실패했습니다.",
          });
        }
      }

      const report: BulkOperationReport = {
        kind: action === "approve" ? "plan_approve" : "plan_retry",
        label: action === "approve" ? "검토 큐 일괄 승인 결과" : "계획 항목 일괄 재실행 결과",
        completed,
        failed,
        items,
      };
      setBulkReport(report);
      await persistBulkReport(report, Date.now() - startedAt).catch(() => null);
      await state.reloadProject(projectId);
    } finally {
      setAutomationBusy(false);
    }
  }

  async function runBulkPublicationRetry(publicationIds: string[]) {
    if (!projectId || publicationIds.length === 0) {
      return;
    }

    setAutomationBusy(true);
    state.setError("");
    setAutomationFeedback(null);
    setPublicationFeedback(null);
    setBulkReport(null);

    try {
      const startedAt = Date.now();
      let completed = 0;
      let failed = 0;
      const items: BulkOperationReport["items"] = [];

      for (const publicationId of publicationIds) {
        try {
          const data = await apiPost<{ publication: { channel: string; provider: string } }>(
            `/api/projects/${projectId}/publications`,
            {
              publicationId,
              executionSource: "studio",
              skipAuditLog: true,
            },
          );
          completed += 1;
          items.push({
            id: publicationId,
            label: `${data.publication.channel} · ${data.publication.provider}`,
            status: "success",
            message: "채널 재시도 성공",
          });
        } catch (error) {
          failed += 1;
          items.push({
            id: publicationId,
            label: publicationId,
            status: "failed",
            message: error instanceof Error ? error.message : "채널 재시도 실패",
          });
        }
      }

      const report: BulkOperationReport = {
        kind: "publication_retry",
        label: "채널 실패 이력 일괄 재시도 결과",
        completed,
        failed,
        items,
      };
      setBulkReport(report);
      await persistBulkReport(report, Date.now() - startedAt).catch(() => null);
      await state.reloadProject(projectId);
    } finally {
      setAutomationBusy(false);
    }
  }

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
          sourceFiles={source.sourceFiles}
          onSourceFilesChange={source.setSourceFiles}
          projectBusy={source.busy}
          onCreateProject={source.handleCreateProject}
          onSelectProject={(id) => { state.reloadProject(id); }}
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
          onGenerate={() => {
            if (projectId) {
              const selectedPlanItem = state.contentPlan?.items.find((item) => item.id === content.selectedTopicId);
              void content.handleGenerate(
                projectId,
                undefined,
                content.topicInput.trim() || undefined,
                content.selectedTopicId || undefined,
                selectedPlanItem?.objective || undefined,
              ).then(() => state.loadContentPlan(projectId));
            }
          }}
          contentPlan={state.contentPlan}
          planBusy={planBusy}
          onGenerateContentPlan={async () => {
            if (!projectId) {
              return;
            }

            setPlanBusy(true);
            state.setError("");

            try {
              const data = await apiPost<{ plan: MonthlyContentPlan }>(`/api/projects/${projectId}/content-plan`, {});
              state.setContentPlan(data.plan);
              if (data.plan.items[0]) {
                content.setSelectedTopicId(data.plan.items[0].id);
                content.setTopicInput(data.plan.items[0].topic);
              }
            } catch (error) {
              state.setError(error instanceof Error ? error.message : "월간 계획 생성에 실패했습니다.");
            } finally {
              setPlanBusy(false);
            }
          }}
          selectedPlannedTopicId={content.selectedTopicId}
          onSelectPlannedTopic={(itemId, topicTitle) => {
            content.setSelectedTopicId(itemId);
            content.setTopicInput(topicTitle);
          }}
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
          publications={state.publications}
          failedPublications={failedPublications}
          publishedPublications={publishedPublications}
          readiness={state.automationReadiness}
          automationBusy={automationBusy}
          automationRun={automationRun}
          automationFeedback={automationFeedback}
          publicationFeedback={publicationFeedback}
          bulkReport={bulkReport}
          bulkReportHistory={state.bulkOperationHistory}
          reviewQueue={reviewQueue}
          readyQueue={readyQueue}
          failedQueue={failedQueue}
          publishedQueue={publishedQueue}
          onRunAutomation={async () => {
            if (!projectId) {
              return;
            }

            setAutomationBusy(true);
            state.setError("");
            setAutomationFeedback(null);
            setPublicationFeedback(null);
            setBulkReport(null);

            try {
              const data = await apiPost<{ run: AutomationRunSummary }>(`/api/projects/${projectId}/automation`, {
                executionSource: "studio",
              });
              setAutomationRun(data.run);
              await state.reloadProject(projectId);
            } catch (error) {
              state.setError(error instanceof Error ? error.message : "프로젝트 자동 실행에 실패했습니다.");
            } finally {
              setAutomationBusy(false);
            }
          }}
          onApproveReview={(planItemId) => {
            if (!projectId) {
              return;
            }

            setAutomationBusy(true);
            state.setError("");
            setPublicationFeedback(null);
            setBulkReport(null);

            void apiPost<{ resolution: AutomationReviewResolution }>(`/api/projects/${projectId}/automation`, {
              action: "approve",
              planItemId,
              executionSource: "studio",
            })
              .then(async (data) => {
                setAutomationFeedback(data.resolution);
                await state.reloadProject(projectId);
              })
              .catch((error) => {
                state.setError(error instanceof Error ? error.message : "검토 승인 처리에 실패했습니다.");
              })
              .finally(() => {
                setAutomationBusy(false);
              });
          }}
          onRetryPlanItem={(planItemId) => {
            if (!projectId) {
              return;
            }

            setAutomationBusy(true);
            state.setError("");
            setPublicationFeedback(null);
            setBulkReport(null);

            void apiPost<{ resolution: AutomationReviewResolution }>(`/api/projects/${projectId}/automation`, {
              action: "retry",
              planItemId,
              executionSource: "studio",
            })
              .then(async (data) => {
                setAutomationFeedback(data.resolution);
                await state.reloadProject(projectId);
              })
              .catch((error) => {
                state.setError(error instanceof Error ? error.message : "자동화 재실행에 실패했습니다.");
              })
              .finally(() => {
                setAutomationBusy(false);
              });
          }}
          onRetryPublication={(publicationId) => {
            if (!projectId) {
              return;
            }

            setAutomationBusy(true);
            state.setError("");
            setAutomationFeedback(null);
            setPublicationFeedback(null);
            setBulkReport(null);

            void apiPost<{ publication: { channel: string; provider: string; externalPostUrl?: string | null } }>(
              `/api/projects/${projectId}/publications`,
              {
                publicationId,
                executionSource: "studio",
              },
            )
              .then(async (data) => {
                setPublicationFeedback(
                  `${data.publication.channel} · ${data.publication.provider} 재시도를 완료했습니다.${
                    data.publication.externalPostUrl ? ` ${data.publication.externalPostUrl}` : ""
                  }`,
                );
                await state.reloadProject(projectId);
              })
              .catch((error) => {
                state.setError(error instanceof Error ? error.message : "채널 재시도에 실패했습니다.");
              })
              .finally(() => {
                setAutomationBusy(false);
              });
          }}
          onBulkApproveReview={(planItemIds) => {
            void runBulkPlanAction(planItemIds, "approve");
          }}
          onBulkRetryPlanItems={(planItemIds) => {
            void runBulkPlanAction(planItemIds, "retry");
          }}
          onBulkRetryPublications={(publicationIds) => {
            void runBulkPublicationRetry(publicationIds);
          }}
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
