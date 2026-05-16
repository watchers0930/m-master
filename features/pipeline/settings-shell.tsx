"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/features/site/app-header";
import { usePipelineState } from "./hooks/use-pipeline-state";
import { usePublishWorkflow } from "../dashboard/use-publish-workflow";
import { useSourceRegistration } from "./hooks/use-source-registration";
import { apiPost } from "./hooks/use-api";
import type { CredentialHealthReport, ProjectOperatorSession } from "../dashboard/types";

type CredentialService = "blogger" | "meta" | "ga4" | "alerts";

export function SettingsShell() {
  const router = useRouter();
  const state = usePipelineState();
  const [projectsResolved, setProjectsResolved] = useState(false);
  const [checkBusy, setCheckBusy] = useState<CredentialService | null>(null);
  const [credentialHealth, setCredentialHealth] = useState<CredentialHealthReport | null>(null);
  const [operatorSession, setOperatorSession] = useState<ProjectOperatorSession | null>(null);
  const projectId = state.activeProject?.project.id ?? null;
  const source = useSourceRegistration({
    onProjectCreated: (project) => {
      state.setActiveProject(project);
    },
    onError: state.setError,
  });

  const publish = usePublishWorkflow({
    projectId,
    onError: state.setError,
    reloadProject: async (nextProjectId: string) => {
      await state.reloadProject(nextProjectId);
    },
  });

  useEffect(() => {
    void state.loadProjects().finally(() => {
      setProjectsResolved(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (projectsResolved && !state.loading && state.projects.length === 0) {
      router.replace("/");
    }
  }, [projectsResolved, state.loading, state.projects.length, router]);

  useEffect(() => {
    if (!projectId && state.projects.length > 0) {
      void state.reloadProject(state.projects[0].id);
    }
  }, [projectId, state.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) {
      setOperatorSession(null);
      setCredentialHealth(null);
      return;
    }

    void loadOperatorSession(projectId);
    void loadCredentialHealth(projectId);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.activeProject) {
      publish.hydratePublishResult(state.activeProject);
      source.hydrateContextForm(state.activeProject);
    }
  }, [state.activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch {
      setOperatorSession(null);
    }
  }

  async function loadCredentialHealth(nextProjectId: string) {
    try {
      const response = await fetch(`/api/projects/${nextProjectId}/credential-checks`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: { health?: CredentialHealthReport }; error?: { message?: string } }
        | null;

      if (!payload?.ok) {
        setCredentialHealth(null);
        return;
      }

      setCredentialHealth(payload.data?.health ?? null);
    } catch {
      setCredentialHealth(null);
    }
  }

  async function handleRunCredentialCheck(service: CredentialService) {
    if (!projectId) {
      return;
    }

    setCheckBusy(service);
    state.setError("");

    try {
      await apiPost(`/api/projects/${projectId}/credential-checks`, { service });
      await state.loadAutomationReadiness(projectId);
      await loadCredentialHealth(projectId);
    } catch (error) {
      state.setError(error instanceof Error ? error.message : "연결 테스트 실행에 실패했습니다.");
    } finally {
      setCheckBusy(null);
    }
  }

  const bloggerCheck = credentialHealth?.services.find((service) => service.service === "blogger")?.latest ?? null;
  const bloggerCheckLabel =
    bloggerCheck?.status === "ready"
      ? "정상"
      : bloggerCheck?.status === "failed"
        ? "오류"
        : bloggerCheck?.status === "warning"
          ? "점검 필요"
          : "미점검";

  return (
    <div className="app-shell">
      <AppHeader active="settings" title="전체 설정" />
      {state.error ? (
        <div className="pipeline-error">
          <p className="error-text">{state.error}</p>
          <button className="button ghost" onClick={state.clearError}>닫기</button>
        </div>
      ) : null}

      <main className="settings-page">
        <section className="settings-hero analytics-surface">
          <div>
            <span className="eyebrow">Project Settings</span>
            <h2>한 번 저장한 채널 설정을 전체 화면에서 재사용합니다.</h2>
            <p>
              Blogger, Meta, 자동화 정책을 여기서 저장해두면 콘텐츠 생성과 운영보드 발행 흐름에서 같은 프로젝트 설정을 그대로 씁니다.
            </p>
          </div>
          <div className="settings-project-switch">
            {state.projects.map((project) => {
              const active = project.id === projectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`settings-project-chip ${active ? "active" : ""}`}
                  onClick={() => void state.reloadProject(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{project.domain || "도메인 없음"}</span>
                </button>
              );
            })}
          </div>
        </section>

        {!state.activeProject ? (
          <section className="analytics-surface settings-card">
            <div className="settings-card-head">
              <h3>프로젝트를 먼저 선택하세요.</h3>
              <p>좌측 목록 대신 위 프로젝트 칩에서 대상 프로젝트를 선택하면 채널 설정을 바로 편집할 수 있습니다.</p>
            </div>
          </section>
        ) : (
          <div className="settings-grid">
            <section className="analytics-surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>브랜드 컨텍스트</h3>
                  <p>초기 상태에서는 여기서 브랜드 요약과 운영 기준을 먼저 저장합니다. 콘텐츠생성과 운영보드는 이 설정이 완료된 뒤 사용하는 화면입니다.</p>
                </div>
                <span className={`status-pill ${state.activeProject.brandProfile?.approved ? "active" : ""}`}>
                  {state.activeProject.brandProfile?.approved ? "컨텍스트 승인됨" : "컨텍스트 미완료"}
                </span>
              </div>
              <div className="settings-form-grid">
                <div className="field-group">
                  <label className="field-label">브랜드 요약</label>
                  <textarea
                    className="text-area"
                    value={source.editingSummary}
                    onChange={(e) => source.setEditingSummary(e.target.value)}
                    rows={5}
                    placeholder="브랜드와 서비스 핵심을 요약하세요."
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">타겟 독자</label>
                  <textarea
                    className="text-area"
                    value={source.editingAudience}
                    onChange={(e) => source.setEditingAudience(e.target.value)}
                    rows={4}
                    placeholder="누구를 위한 콘텐츠인지 적어주세요."
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">톤</label>
                  <input
                    className="text-input"
                    value={source.editingTone}
                    onChange={(e) => source.setEditingTone(e.target.value)}
                    placeholder="예: 신뢰감 있고 차분한 실무형 톤"
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">CTA</label>
                  <input
                    className="text-input"
                    value={source.editingCta}
                    onChange={(e) => source.setEditingCta(e.target.value)}
                    placeholder="예: 계약 전에 위험 신호를 먼저 점검해 보세요."
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">금지 표현</label>
                  <textarea
                    className="text-area"
                    value={source.editingBannedTerms}
                    onChange={(e) => source.setEditingBannedTerms(e.target.value)}
                    rows={4}
                    placeholder="예: 100% 보장, 무조건 안전, 업계 1위"
                  />
                </div>
              </div>
              <div className="button-row">
                <button className="button ghost" disabled={source.contextBusy} onClick={() => void source.handleSaveContextDraft(projectId!)}>
                  {source.contextBusy ? "저장 중…" : "컨텍스트 임시 저장"}
                </button>
                <button className="button primary" disabled={source.contextBusy || !source.editingSummary.trim()} onClick={() => void source.handleApproveContext(projectId!)}>
                  {source.contextBusy ? "처리 중…" : "컨텍스트 저장 및 승인"}
                </button>
              </div>
              <p className="fine-print">설정 화면에서 컨텍스트, 채널, 자동화 정책을 모두 끝내면 그다음에만 콘텐츠생성과 운영보드를 쓰면 됩니다.</p>
            </section>

            <section className="analytics-surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>운영자 세션</h3>
                  <p>설정 저장은 루트 로그인에서 생성된 owner 권한 세션이 필요합니다.</p>
                </div>
              </div>
              <div className="settings-status-row">
                <span className={`status-pill ${operatorSession ? "active" : ""}`}>
                  {operatorSession ? `${operatorSession.name} · ${operatorSession.role}` : "로그인 안 됨"}
                </span>
              </div>
              {!operatorSession ? <p className="fine-print">루트 로그인 화면에서 이 프로젝트로 먼저 로그인한 뒤 다시 들어오세요.</p> : null}
            </section>

            <section className="analytics-surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>Blogger 채널</h3>
                  <p>Blogger 기본값만 먼저 저장합니다. 여기서 저장한 값은 발행 화면에서 자동으로 재사용됩니다.</p>
                </div>
                <div className="button-row">
                  <span className={`status-pill ${bloggerCheck?.status === "ready" ? "active" : ""}`}>
                    Blogger 테스트 {bloggerCheckLabel}
                  </span>
                  <button className="button ghost" disabled={checkBusy !== null} onClick={() => void handleRunCredentialCheck("blogger")}>
                    {checkBusy === "blogger" ? "점검 중…" : "Blogger 테스트"}
                  </button>
                </div>
              </div>
              <div className="settings-form-grid">
                <div className="field-group">
                  <label className="field-label">Blogger Blog ID</label>
                  <input className="text-input" value={publish.wordpressConfig.bloggerBlogId} onChange={(e) => publish.handleWordPressConfigChange("bloggerBlogId", e.target.value)} placeholder="1328314357427808267" />
                </div>
                <div className="field-group">
                  <label className="field-label">Blogger Access Token</label>
                  <input className="text-input" type="password" value={publish.wordpressConfig.bloggerAccessToken} onChange={(e) => publish.handleWordPressConfigChange("bloggerAccessToken", e.target.value)} placeholder={state.activeProject.project.hasBloggerAccessToken ? "비워두면 기존 값 유지" : "OAuth access token"} />
                  {state.activeProject.project.hasBloggerAccessToken && !publish.wordpressConfig.bloggerAccessToken ? (
                    <p className="fine-print">저장된 토큰이 있습니다. 보안상 다시 표시하지 않습니다. 변경할 때만 새 토큰을 입력하세요.</p>
                  ) : null}
                </div>
                <div className="field-group">
                  <label className="field-label">Blogger 게시 상태</label>
                  <select className="text-input" value={publish.wordpressConfig.bloggerStatus} onChange={(e) => publish.handleWordPressConfigChange("bloggerStatus", e.target.value)}>
                    <option value="draft">draft</option>
                    <option value="publish">publish</option>
                  </select>
                </div>
              </div>
              <div className="button-row">
                <button className="button primary" disabled={publish.settingsBusy} onClick={() => void publish.handleSaveBloggerSettings()}>
                  {publish.settingsBusy ? "Blogger 저장 중…" : "Blogger 정보 저장"}
                </button>
              </div>
              {bloggerCheck ? (
                <div className="settings-status-row">
                  <span className={`status-pill ${bloggerCheck.status === "ready" ? "active" : ""}`}>{bloggerCheck.summary}</span>
                  <span className="fine-print">{bloggerCheck.detail}</span>
                </div>
              ) : null}
            </section>

            <section className="analytics-surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>소셜 채널</h3>
                  <p>Meta 연동 정보와 페이지 식별자를 저장합니다.</p>
                </div>
                <button className="button ghost" disabled={checkBusy !== null} onClick={() => void handleRunCredentialCheck("meta")}>
                  {checkBusy === "meta" ? "점검 중…" : "Meta 테스트"}
                </button>
              </div>
              <div className="settings-form-grid">
                <div className="field-group">
                  <label className="field-label">Meta Access Token</label>
                  <input className="text-input" type="password" value={publish.wordpressConfig.metaAccessToken} onChange={(e) => publish.handleWordPressConfigChange("metaAccessToken", e.target.value)} placeholder={state.activeProject.project.hasMetaAccessToken ? "비워두면 기존 값 유지" : "Meta Graph access token"} />
                </div>
                <div className="field-group">
                  <label className="field-label">Facebook Page ID</label>
                  <input className="text-input" value={publish.wordpressConfig.facebookPageId} onChange={(e) => publish.handleWordPressConfigChange("facebookPageId", e.target.value)} placeholder="1234567890" />
                </div>
                <div className="field-group">
                  <label className="field-label">Instagram Business Account ID</label>
                  <input className="text-input" value={publish.wordpressConfig.instagramBusinessAccountId} onChange={(e) => publish.handleWordPressConfigChange("instagramBusinessAccountId", e.target.value)} placeholder="1784..." />
                </div>
              </div>
            </section>

            <section className="analytics-surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>자동화 정책</h3>
                  <p>리뷰 가드레일과 자동 게시 기준을 프로젝트 단위로 저장합니다.</p>
                </div>
                <button className="button ghost" disabled={checkBusy !== null} onClick={() => void handleRunCredentialCheck("ga4")}>
                  {checkBusy === "ga4" ? "점검 중…" : "GA4 테스트"}
                </button>
              </div>
              <div className="settings-form-grid">
                <div className="field-group">
                  <label className="field-label">자동화 모드</label>
                  <select className="text-input" value={publish.wordpressConfig.automationMode} onChange={(e) => publish.handleWordPressConfigChange("automationMode", e.target.value)}>
                    <option value="draft-only">draft-only</option>
                    <option value="approved-auto-publish">approved-auto-publish</option>
                    <option value="full-auto">full-auto</option>
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">리뷰 가드레일</label>
                  <select className="text-input" value={publish.wordpressConfig.automationRequireReview ? "enabled" : "disabled"} onChange={(e) => publish.handleWordPressConfigChange("automationRequireReview", e.target.value === "enabled")}>
                    <option value="enabled">enabled</option>
                    <option value="disabled">disabled</option>
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">최소 종합 점수</label>
                  <input className="text-input" value={publish.wordpressConfig.automationMinOverallScore} onChange={(e) => publish.handleWordPressConfigChange("automationMinOverallScore", e.target.value)} placeholder="75" />
                </div>
                <div className="field-group">
                  <label className="field-label">최소 리스크 점수</label>
                  <input className="text-input" value={publish.wordpressConfig.automationMinRiskScore} onChange={(e) => publish.handleWordPressConfigChange("automationMinRiskScore", e.target.value)} placeholder="80" />
                </div>
              </div>
            </section>

            <section className="analytics-surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>저장 상태</h3>
                  <p>여기서 저장한 값은 콘텐츠 생성, 운영보드, 발행 준비 화면에서 공통으로 사용됩니다.</p>
                </div>
              </div>
              <div className="settings-status-row">
                <span className={`status-pill ${state.activeProject.brandProfile?.approved ? "active" : ""}`}>
                  {state.activeProject.brandProfile?.approved ? "브랜드 컨텍스트 승인됨" : "브랜드 컨텍스트 미완료"}
                </span>
                <span className={`status-pill ${state.activeProject.project.hasBloggerAccessToken ? "active" : ""}`}>
                  {state.activeProject.project.hasBloggerAccessToken ? "Blogger 토큰 저장됨" : "Blogger 토큰 미등록"}
                </span>
                <span className={`status-pill ${state.activeProject.project.hasMetaAccessToken ? "active" : ""}`}>
                  {state.activeProject.project.hasMetaAccessToken ? "Meta 토큰 저장됨" : "Meta 토큰 미등록"}
                </span>
              </div>
              <div className="button-row">
                <button className="button primary" disabled={publish.settingsBusy} onClick={() => void publish.handleSaveWordPressDefaults()}>
                  {publish.settingsBusy ? "설정 저장 중…" : "전체 설정 저장"}
                </button>
                <a className="button ghost" href={`/studio?projectId=${state.activeProject.project.id}`}>
                  스튜디오로 이동
                </a>
                <a className="button ghost" href={`/studio/operations?projectId=${state.activeProject.project.id}`}>
                  운영보드로 이동
                </a>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
