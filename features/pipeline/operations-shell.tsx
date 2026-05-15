"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/features/site/app-header";
import { apiGet, apiPatch, apiPost } from "./hooks/use-api";

type ProjectListItem = {
  id: string;
  name: string;
  domain?: string | null;
  status: string;
  updatedAt: string;
};

type PlanItem = {
  id: string;
  weekLabel: string;
  topic: string;
  intentType?: string | null;
  objective?: string | null;
  rationale?: string | null;
  status: string;
  contentJobId?: string | null;
  generatedAt?: string | null;
};

type MonthlyPlan = {
  id: string;
  monthKey: string;
  status: string;
  basisSummary?: string | null;
  autoGenerate: boolean;
  generatedAt?: string | null;
  lastExecutedAt?: string | null;
  items: PlanItem[];
};

type ProjectDetail = {
  project: {
    id: string;
    name: string;
    domain?: string | null;
    status: string;
    wordpressSiteUrl?: string | null;
    wordpressUsername?: string | null;
    wordpressStatus?: string | null;
    updatedAt: string;
  };
  brandProfile: {
    approved: boolean;
    summary: string;
    tone?: string | null;
    cta?: string | null;
  } | null;
  latestContentJob?: {
    id: string;
    topic: string;
    status: string;
    publishProvider?: string | null;
    externalPostUrl?: string | null;
    publishedAt?: string | null;
  } | null;
  latestContentPlan?: MonthlyPlan | null;
};

type ActivityItem = {
  id: string;
  kind: string;
  title: string;
  description: string;
  timestamp: string;
};

function groupLabel(status: string) {
  switch (status) {
    case "planned":
      return "계획됨";
    case "ready_to_publish":
      return "발행 대기";
    case "published":
      return "게시 완료";
    case "failed":
      return "실패";
    case "needs_review":
      return "검토 필요";
    default:
      return status;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "없음";
  }

  return new Date(value).toLocaleString("ko-KR");
}

export function OperationsShell() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [history, setHistory] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function loadProjects() {
    const data = await apiGet<{ projects: ProjectListItem[] }>("/api/projects");
    setProjects(data.projects);
    return data.projects;
  }

  async function loadProjectBundle(projectId: string) {
    const [projectData, planData, historyData] = await Promise.all([
      apiGet<{ project: ProjectDetail }>(`/api/projects/${projectId}`),
      apiGet<{ plan: MonthlyPlan | null }>(`/api/projects/${projectId}/monthly-plan`),
      apiGet<{ history: ActivityItem[] }>(`/api/projects/${projectId}/history`),
    ]);

    setProjectDetail(projectData.project);
    setPlan(planData.plan);
    setHistory(historyData.history);
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setLoading(true);
      setError("");

      try {
        const list = await loadProjects();
        if (cancelled) {
          return;
        }

        if (list.length === 0) {
          setActiveProjectId("");
          setProjectDetail(null);
          setPlan(null);
          setHistory([]);
          return;
        }

        const initialId = activeProjectId || list[0].id;
        setActiveProjectId(initialId);
        await loadProjectBundle(initialId);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "운영보드를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSelectProject(projectId: string) {
    setLoading(true);
    setError("");
    setFeedback("");
    setActiveProjectId(projectId);

    try {
      await loadProjectBundle(projectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePlan() {
    if (!activeProjectId) {
      return;
    }

    setActionBusy(true);
    setError("");
    setFeedback("");

    try {
      const data = await apiPost<{ plan: MonthlyPlan }>(`/api/projects/${activeProjectId}/monthly-plan`, {
        autoGenerate: true,
      });
      setPlan(data.plan);
      setFeedback("월간 계획을 다시 생성했습니다.");
      await loadProjectBundle(activeProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "월간 계획 생성에 실패했습니다.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRunPlan() {
    if (!activeProjectId) {
      return;
    }

    setActionBusy(true);
    setError("");
    setFeedback("");

    try {
      await apiPatch<{ result: unknown }>(`/api/projects/${activeProjectId}/monthly-plan`, {});
      setFeedback("월간 계획 실행을 완료했습니다.");
      await loadProjectBundle(activeProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "월간 계획 실행에 실패했습니다.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handlePreparePublish() {
    if (!activeProjectId) {
      return;
    }

    setActionBusy(true);
    setError("");
    setFeedback("");

    try {
      await apiPost<{ publish: { status: string } }>(`/api/projects/${activeProjectId}/publish`, {});
      setFeedback("최신 콘텐츠를 발행 준비 상태로 반영했습니다.");
      await loadProjectBundle(activeProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "발행 준비 처리에 실패했습니다.");
    } finally {
      setActionBusy(false);
    }
  }

  const groupedItems = useMemo(() => {
    const source = plan?.items || [];
    return {
      needsReview: source.filter((item) => item.status === "needs_review"),
      ready: source.filter((item) => item.status === "ready_to_publish"),
      failed: source.filter((item) => item.status === "failed"),
      published: source.filter((item) => item.status === "published"),
      planned: source.filter((item) => item.status !== "needs_review" && item.status !== "ready_to_publish" && item.status !== "failed" && item.status !== "published"),
    };
  }, [plan]);

  const totalPlanItems = plan?.items.length || 0;

  return (
    <div className="app-shell">
      <AppHeader active="operations" title="운영 보드" />

      {error ? (
        <div className="pipeline-error">
          <p className="error-text">{error}</p>
          <button className="button ghost" onClick={() => setError("")}>닫기</button>
        </div>
      ) : null}

      <div className="pipeline-grid">
        <aside className="sidebar-panel">
          <details className="sb-section" open>
            <summary className="sb-section-title">프로젝트</summary>
            <div className="sb-section-body">
              <div className="stack">
                {projects.length === 0 ? (
                  <p className="fine-print">등록된 프로젝트가 없습니다.</p>
                ) : (
                  projects.map((project) => (
                    <button
                      key={project.id}
                      className="button ghost"
                      onClick={() => void handleSelectProject(project.id)}
                      style={{
                        justifyContent: "flex-start",
                        borderColor: project.id === activeProjectId ? "rgba(59, 130, 246, 0.55)" : undefined,
                        background: project.id === activeProjectId ? "rgba(59, 130, 246, 0.12)" : undefined,
                      }}
                    >
                      {project.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          </details>

          {projectDetail ? (
            <details className="sb-section" open>
              <summary className="sb-section-title">실행</summary>
              <div className="sb-section-body">
                <div className="stack">
                  <span className="fine-print">{projectDetail.project.domain || "도메인 없음"}</span>
                  <span className="fine-print">
                    컨텍스트 승인 {projectDetail.brandProfile?.approved ? "완료" : "필요"}
                  </span>
                  <span className="fine-print">
                    워드프레스 {projectDetail.project.wordpressSiteUrl ? "설정됨" : "미설정"}
                  </span>
                  <button className="button primary" disabled={actionBusy} onClick={() => void handleGeneratePlan()}>
                    {actionBusy ? "처리 중..." : "월간 계획 생성"}
                  </button>
                  <button className="button ghost" disabled={actionBusy} onClick={() => void handleRunPlan()}>
                    계획 실행
                  </button>
                  <button className="button ghost" disabled={actionBusy} onClick={() => void handlePreparePublish()}>
                    최신 콘텐츠 발행 준비
                  </button>
                  {feedback ? <span className="fine-print">{feedback}</span> : null}
                </div>
              </div>
            </details>
          ) : null}
        </aside>

        <section className="content-panel soft-scrollbar">
          {loading ? (
            <div className="operations-empty-card">
              <strong>운영보드 로딩 중</strong>
              <span className="fine-print">프로젝트와 실행 상태를 불러오고 있습니다.</span>
            </div>
          ) : !projectDetail ? (
            <div className="operations-empty-card">
              <strong>프로젝트 없음</strong>
              <span className="fine-print">좌측에서 프로젝트를 선택하면 운영 상태가 표시됩니다.</span>
            </div>
          ) : (
            <div className="operations-board-page">
              <section className="operations-hero-card">
                <div className="operations-hero-copy">
                  <span className="eyebrow">Operations</span>
                  <h2 className="operations-page-title">{projectDetail.project.name}</h2>
                  <p className="operations-page-subcopy">
                    월간 계획 생성, 실행, 발행 준비와 최근 작업 흐름을 한 화면에서 확인합니다.
                  </p>
                  <div className="operations-meta-row">
                    <span className="operations-meta-pill">마지막 업데이트 {formatDateTime(projectDetail.project.updatedAt)}</span>
                    <span className="operations-meta-pill">최근 발행 상태 {projectDetail.latestContentJob?.status || "없음"}</span>
                    <span className="operations-meta-pill">계획 항목 {totalPlanItems}건</span>
                  </div>
                </div>
                <div className="operations-hero-aside">
                  <span className="fine-print">최근 콘텐츠</span>
                  <strong>{projectDetail.latestContentJob?.topic || "아직 생성된 콘텐츠 없음"}</strong>
                  {projectDetail.latestContentJob?.externalPostUrl ? (
                    <a className="fine-print" href={projectDetail.latestContentJob.externalPostUrl} target="_blank" rel="noreferrer">
                      게시 링크 열기
                    </a>
                  ) : null}
                </div>
              </section>

              <section className="operations-stats-grid">
                <article className="operations-stat-card">
                  <span>검토 필요</span>
                  <strong>{groupedItems.needsReview.length}</strong>
                  <p>운영자 확인이 필요한 항목</p>
                </article>
                <article className="operations-stat-card">
                  <span>발행 대기</span>
                  <strong>{groupedItems.ready.length}</strong>
                  <p>게시 준비 완료된 항목</p>
                </article>
                <article className="operations-stat-card">
                  <span>실패</span>
                  <strong>{groupedItems.failed.length}</strong>
                  <p>다시 실행이 필요한 항목</p>
                </article>
                <article className="operations-stat-card">
                  <span>게시 완료</span>
                  <strong>{groupedItems.published.length}</strong>
                  <p>최근 게시 완료된 항목</p>
                </article>
              </section>

              <section className="operations-two-col-grid">
                <article className="operations-surface-card">
                  <div className="operations-section-head">
                    <div>
                      <p className="operations-kicker">Plan</p>
                      <h3>월간 계획 요약</h3>
                    </div>
                  </div>
                  {plan ? (
                    <div className="operations-plan-summary">
                      <span className="operations-meta-pill">{plan.monthKey}</span>
                      <span className="operations-meta-pill">상태 {groupLabel(plan.status)}</span>
                      <span className="operations-meta-pill">생성 {formatDateTime(plan.generatedAt)}</span>
                      {plan.lastExecutedAt ? (
                        <span className="operations-meta-pill">실행 {formatDateTime(plan.lastExecutedAt)}</span>
                      ) : null}
                      {plan.basisSummary ? <p>{plan.basisSummary}</p> : null}
                    </div>
                  ) : (
                    <p className="fine-print">아직 월간 계획이 없습니다.</p>
                  )}
                </article>

                <article className="operations-surface-card">
                  <div className="operations-section-head">
                    <div>
                      <p className="operations-kicker">Status</p>
                      <h3>운영 상태</h3>
                    </div>
                  </div>
                  <div className="operations-status-list">
                    <div className="operations-status-row">
                      <span>도메인</span>
                      <strong>{projectDetail.project.domain || "도메인 없음"}</strong>
                    </div>
                    <div className="operations-status-row">
                      <span>컨텍스트 승인</span>
                      <strong>{projectDetail.brandProfile?.approved ? "완료" : "필요"}</strong>
                    </div>
                    <div className="operations-status-row">
                      <span>워드프레스</span>
                      <strong>{projectDetail.project.wordpressSiteUrl ? "설정됨" : "미설정"}</strong>
                    </div>
                    <div className="operations-status-row">
                      <span>최근 콘텐츠</span>
                      <strong>{projectDetail.latestContentJob?.topic || "없음"}</strong>
                    </div>
                  </div>
                </article>
              </section>

              <section className="operations-section-stack">
                {([
                  ["검토 필요", groupedItems.needsReview],
                  ["발행 대기", groupedItems.ready],
                  ["실패", groupedItems.failed],
                  ["게시 완료", groupedItems.published],
                  ["기타 계획", groupedItems.planned],
                ] as Array<[string, PlanItem[]]>).map(([title, items]) =>
                  Array.isArray(items) && items.length > 0 ? (
                    <article key={title} className="operations-surface-card">
                      <div className="operations-section-head">
                        <div>
                          <p className="operations-kicker">Queue</p>
                          <h3>{title}</h3>
                        </div>
                        <span className="operations-count-badge">{items.length}건</span>
                      </div>
                      <div className="operations-item-list">
                        {items.map((item) => (
                          <div key={item.id} className="operations-item-card">
                            <div className="operations-item-head">
                              <strong>{item.weekLabel} · {item.topic}</strong>
                              <span className={`operations-status-chip status-${item.status}`}>{groupLabel(item.status)}</span>
                            </div>
                            <div className="operations-item-meta">
                              {item.intentType ? <span>{item.intentType}</span> : null}
                              {item.objective ? <span>목표 {item.objective}</span> : null}
                              {item.generatedAt ? <span>생성 {formatDateTime(item.generatedAt)}</span> : null}
                            </div>
                            {item.rationale ? <p>{item.rationale}</p> : null}
                          </div>
                        ))}
                      </div>
                    </article>
                  ) : null,
                )}
              </section>

              <section className="operations-section-stack">
                <article className="operations-surface-card">
                  <div className="operations-section-head">
                    <div>
                      <p className="operations-kicker">Timeline</p>
                      <h3>최근 작업 이력</h3>
                    </div>
                    <span className="operations-count-badge">{Math.min(history.length, 12)}건</span>
                  </div>
                  <div className="operations-timeline">
                    {history.length === 0 ? (
                      <span className="fine-print">기록된 이력이 없습니다.</span>
                    ) : (
                      history.slice(0, 12).map((item) => (
                        <div key={item.id} className="operations-timeline-item">
                          <div className="operations-timeline-dot" />
                          <div className="operations-timeline-body">
                            <strong>{item.title}</strong>
                            <span className="fine-print">{formatDateTime(item.timestamp)}</span>
                            <p>{item.description}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
