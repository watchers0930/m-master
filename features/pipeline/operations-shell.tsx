"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/features/site/app-header";
import { OperationsBoard } from "./components/operations-board";
import { usePipelineState } from "./hooks/use-pipeline-state";
import { apiPost } from "./hooks/use-api";
import { usePublishWorkflow } from "../dashboard/use-publish-workflow";
import type { AutomationReviewResolution, AutomationRunSummary, BulkOperationReport, MonthlyContentPlan, ProjectListItem } from "./types";
import type { ProjectOperatorSession } from "../dashboard/types";

export function OperationsShell() {
  const state = usePipelineState();
  const [planBusy, setPlanBusy] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationRun, setAutomationRun] = useState<AutomationRunSummary | null>(null);
  const [automationFeedback, setAutomationFeedback] = useState<AutomationReviewResolution | null>(null);
  const [publicationFeedback, setPublicationFeedback] = useState<string | null>(null);
  const [bulkReport, setBulkReport] = useState<BulkOperationReport | null>(null);
  const [operatorSession, setOperatorSession] = useState<ProjectOperatorSession | null>(null);
  const [operatorLoginName, setOperatorLoginName] = useState("admin");
  const [operatorLoginKey, setOperatorLoginKey] = useState("1111");
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const autoLoginAttemptedProjectIdRef = useRef<string | null>(null);
  const projectId = state.activeProject?.project?.id;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextProjectId = new URLSearchParams(window.location.search).get("projectId");
    setRequestedProjectId(nextProjectId);
  }, []);

  const publish = usePublishWorkflow({
    projectId,
    onError: state.setError,
    reloadProject: async (nextProjectId: string) => {
      await state.reloadProject(nextProjectId);
    },
  });

  useEffect(() => {
    void state.loadProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId && state.projects.length > 0) {
      const preferredProjectId = requestedProjectId && state.projects.some((project) => project.id === requestedProjectId) ? requestedProjectId : state.projects[0].id;
      void state.reloadProject(preferredProjectId);
    }
  }, [projectId, requestedProjectId, state.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) {
      setOperatorSession(null);
      autoLoginAttemptedProjectIdRef.current = null;
      return;
    }

    void loadOperatorSession(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || operatorSession || operatorBusy) {
      return;
    }

    if (autoLoginAttemptedProjectIdRef.current === projectId) {
      return;
    }

    autoLoginAttemptedProjectIdRef.current = projectId;
    void handleOperatorLogin();
  }, [projectId, operatorSession, operatorBusy]);

  useEffect(() => {
    if (state.activeProject) {
      publish.hydratePublishResult(state.activeProject);
    }
  }, [state.activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

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
      executionSource: "studio/operations",
      durationMs,
    });
  }

  async function handleSelectProject(nextProject: ProjectListItem) {
    state.setError("");
    setAutomationFeedback(null);
    setPublicationFeedback(null);
    setBulkReport(null);
    await state.reloadProject(nextProject.id);
  }

  async function loadOperatorSession(nextProjectId: string) {
    try {
      const response = await fetch(`/api/projects/${nextProjectId}/operators/session`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: { operator?: ProjectOperatorSession | null }; error?: { message?: string } }
        | null;

      if (!payload?.ok) {
        throw new Error(payload?.error?.message || "운영자 세션을 확인하지 못했습니다.");
      }

      setOperatorSession(payload.data?.operator ?? null);
    } catch (error) {
      setOperatorSession(null);
      state.setError(error instanceof Error ? error.message : "운영자 세션을 확인하지 못했습니다.");
    }
  }

  async function handleOperatorLogin() {
    if (!projectId) {
      return;
    }

    setOperatorBusy(true);
    state.setError("");

    try {
      const requestSession = async () => {
        const response = await fetch(`/api/projects/${projectId}/operators/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: operatorLoginName,
            accessKey: operatorLoginKey,
          }),
        });
        return (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: { operator?: ProjectOperatorSession | null }; error?: { message?: string } }
          | null;
      };

      let payload = await requestSession();

      if (!payload?.ok && payload?.error?.message === "운영자 계정을 찾지 못했습니다.") {
        const operatorsResponse = await fetch(`/api/projects/${projectId}/operators`, { cache: "no-store" });
        const operatorsPayload = (await operatorsResponse.json().catch(() => null)) as
          | { ok?: boolean; data?: { bootstrapRequired?: boolean }; error?: { message?: string } }
          | null;

        if (operatorsPayload?.ok && operatorsPayload.data?.bootstrapRequired) {
          const bootstrapResponse = await fetch(`/api/projects/${projectId}/operators`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: operatorLoginName,
              accessKey: operatorLoginKey,
              role: "owner",
              bootstrapSecret: operatorLoginKey,
            }),
          });
          const bootstrapPayload = (await bootstrapResponse.json().catch(() => null)) as
            | { ok?: boolean; error?: { message?: string } }
            | null;

          if (!bootstrapPayload?.ok) {
            throw new Error(bootstrapPayload?.error?.message || "운영자 계정을 생성하지 못했습니다.");
          }

          payload = await requestSession();
        }
      }

      if (!payload?.ok || !payload.data?.operator) {
        throw new Error(payload?.error?.message || "운영자 로그인에 실패했습니다.");
      }

      setOperatorSession(payload.data.operator);
      setOperatorLoginKey("1111");
    } catch (error) {
      state.setError(error instanceof Error ? error.message : "운영자 로그인에 실패했습니다.");
    } finally {
      setOperatorBusy(false);
    }
  }

  async function handleOperatorLogout() {
    if (!projectId) {
      return;
    }

    setOperatorBusy(true);
    state.setError("");

    try {
      await fetch(`/api/projects/${projectId}/operators/session`, {
        method: "DELETE",
      });
      setOperatorSession(null);
    } catch (error) {
      state.setError(error instanceof Error ? error.message : "운영자 로그아웃에 실패했습니다.");
    } finally {
      setOperatorBusy(false);
    }
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
            executionSource: "studio/operations",
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

  async function handleGenerateContentPlan() {
    if (!projectId) {
      return;
    }

    setPlanBusy(true);
    state.setError("");

    try {
      const data = await apiPost<{ plan: MonthlyContentPlan }>(`/api/projects/${projectId}/content-plan`, {});
      state.setContentPlan(data.plan);
      await state.reloadProject(projectId);
    } catch (error) {
      state.setError(error instanceof Error ? error.message : "월간 계획 생성에 실패했습니다.");
    } finally {
      setPlanBusy(false);
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
              executionSource: "studio/operations",
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
      <AppHeader active="operations" title="운영 보드" />
      {state.error ? (
        <div className="pipeline-error">
          <p className="error-text">{state.error}</p>
          <button className="button ghost" onClick={state.clearError}>닫기</button>
        </div>
      ) : null}
      <div className="pipeline-grid">
        <aside className="sidebar-panel">
          <details className="sb-section" open>
            <summary className="sb-section-title">프로젝트 선택</summary>
            <div className="sb-section-body">
              <div className="sb-project-list">
                {state.projects.map((project) => (
                  <button key={project.id} className="sb-project-item" onClick={() => void handleSelectProject(project)}>
                    <strong>{project.name}</strong>
                    <span className="fine-print">{project.domain || "도메인 없음"}</span>
                  </button>
                ))}
              </div>
            </div>
          </details>
          {state.activeProject ? (
            <details className="sb-section" open>
              <summary className="sb-section-title">운영자 로그인</summary>
              <div className="sb-section-body">
                <div className="sb-form">
                  <div className="sb-active-project">
                    <strong>{operatorSession ? `${operatorSession.name} · ${operatorSession.role}` : "로그인 안 됨"}</strong>
                    <span className="fine-print">
                      {operatorSession ? "이 세션으로 자동 실행, 승인, 재시도를 수행합니다." : "프로젝트 운영 권한이 필요한 작업 전에 로그인하세요."}
                    </span>
                  </div>
                  {!operatorSession ? (
                    <>
                      <div className="field-group">
                        <label className="field-label">운영자 이름</label>
                        <input className="text-input" value={operatorLoginName} onChange={(e) => setOperatorLoginName(e.target.value)} />
                      </div>
                      <div className="field-group">
                        <label className="field-label">접근 키</label>
                        <input className="text-input" type="password" value={operatorLoginKey} onChange={(e) => setOperatorLoginKey(e.target.value)} />
                      </div>
                      <button className="button primary sb-btn-full" disabled={operatorBusy || !operatorLoginName.trim() || !operatorLoginKey.trim()} onClick={() => void handleOperatorLogin()}>
                        {operatorBusy ? "로그인 중…" : "운영자 로그인"}
                      </button>
                      <p className="fine-print">기본 입력값은 `admin / 1111`입니다.</p>
                    </>
                  ) : (
                    <button className="button ghost sb-btn-full" disabled={operatorBusy} onClick={() => void handleOperatorLogout()}>
                      {operatorBusy ? "처리 중…" : "로그아웃"}
                    </button>
                  )}
                </div>
              </div>
            </details>
          ) : null}
          {state.activeProject ? (
            <details className="sb-section" open>
              <summary className="sb-section-title">채널 설정</summary>
              <div className="sb-section-body">
                <div className="sb-form">
                  <div className="field-group">
                    <label className="field-label">WP 사이트 URL</label>
                    <input className="text-input" value={publish.wordpressConfig.siteUrl} onChange={(e) => publish.handleWordPressConfigChange("siteUrl", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">사용자명</label>
                    <input className="text-input" value={publish.wordpressConfig.username} onChange={(e) => publish.handleWordPressConfigChange("username", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">앱 비밀번호</label>
                    <input className="text-input" type="password" value={publish.wordpressConfig.appPassword} onChange={(e) => publish.handleWordPressConfigChange("appPassword", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Meta Access Token</label>
                    <input className="text-input" type="password" value={publish.wordpressConfig.metaAccessToken} onChange={(e) => publish.handleWordPressConfigChange("metaAccessToken", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Facebook Page ID</label>
                    <input className="text-input" value={publish.wordpressConfig.facebookPageId} onChange={(e) => publish.handleWordPressConfigChange("facebookPageId", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Instagram Business Account ID</label>
                    <input className="text-input" value={publish.wordpressConfig.instagramBusinessAccountId} onChange={(e) => publish.handleWordPressConfigChange("instagramBusinessAccountId", e.target.value)} />
                  </div>
                  <button className="button ghost sb-btn-full" disabled={publish.settingsBusy} onClick={publish.handleSaveWordPressDefaults}>
                    {publish.settingsBusy ? "저장 중…" : "채널 설정 저장"}
                  </button>
                </div>
              </div>
            </details>
          ) : null}
        </aside>
        <section className="content-panel">
          {!state.activeProject ? (
            <div className="cp-empty">
              <span className="eyebrow">운영 보드</span>
              <p className="fine-print">좌측에서 프로젝트를 선택하면 운영 큐와 채널 이력이 표시됩니다.</p>
            </div>
          ) : (
            <div className="operations-page">
              <div className="operations-page-header">
                <span className="eyebrow">Operations</span>
                <h2 className="brand-title" style={{ margin: 0 }}>{state.activeProject.project.name}</h2>
                <p className="fine-print">
                  월간 계획 실행 상태, 채널 실패, 승인 대기 항목을 한 곳에서 처리합니다.
                </p>
                <div className="button-row operations-header-actions">
                  <button className="button primary" disabled={planBusy || !state.activeProject.brandProfile?.approved} onClick={() => void handleGenerateContentPlan()}>
                    {planBusy ? "계획 생성 중…" : state.contentPlan ? "월간 계획 다시 생성" : "월간 계획 생성"}
                  </button>
                  {!state.activeProject.brandProfile?.approved ? (
                    <span className="fine-print">콘텍스트 승인 후 월간 계획을 생성할 수 있습니다.</span>
                  ) : null}
                </div>
                {state.activeProject.brandProfile?.approved ? (
                  <p className="fine-print operations-header-hint">
                    생성 후 결과는 이 화면 아래 운영 큐와 /studio의 콘텐츠 생성 섹션 안 월간 마케팅 계획 영역에서 바로 확인됩니다.
                  </p>
                ) : null}
              </div>
              <OperationsBoard
                projectId={projectId}
                contentPlan={state.contentPlan}
                wordpressConfig={publish.wordpressConfig}
                onWordPressConfigChange={publish.handleWordPressConfigChange}
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
                      executionSource: "studio/operations",
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
                    executionSource: "studio/operations",
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
                    executionSource: "studio/operations",
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
                      executionSource: "studio/operations",
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
            </div>
          )}
        </section>
        <aside className="image-panel">
          <div className="ip-header">
            <span className="eyebrow">우측 패널</span>
          </div>
          <div className="operations-placeholder-panel">
            <div className="operations-placeholder-card">
              <strong>데이터 준비중</strong>
              <p className="fine-print">최근 실행, 알림, 게시 이력 같은 보조 패널이 이 영역에 들어올 예정입니다.</p>
            </div>
            <div className="operations-placeholder-skeleton" />
            <div className="operations-placeholder-skeleton tall" />
            <div className="operations-placeholder-skeleton" />
          </div>
        </aside>
      </div>
    </div>
  );
}
