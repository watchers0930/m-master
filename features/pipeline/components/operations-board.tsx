"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch } from "../hooks/use-api";
import type {
  AutomationReviewResolution,
  AutomationReadinessReport,
  AutomationRunSummary,
  BulkOperationHistoryItem,
  BulkOperationReport,
  ChannelPublicationSummary,
  ContentJobDetail,
  MonthlyContentPlan,
} from "../types";

type OperationsFilter =
  | "all"
  | "actionable"
  | "needs_review"
  | "ready_to_publish"
  | "failed"
  | "published"
  | "channel_failed"
  | "channel_published";

type OperationsSort = "priority" | "scheduled" | "recent" | "oldest";
const OPERATIONS_VIEW_STORAGE_KEY = "m-master:operations-view";

type Props = {
  projectId?: string | null;
  contentPlan: MonthlyContentPlan | null;
  publications: ChannelPublicationSummary[];
  failedPublications: ChannelPublicationSummary[];
  publishedPublications: ChannelPublicationSummary[];
  readiness: AutomationReadinessReport | null;
  automationBusy: boolean;
  automationRun: AutomationRunSummary | null;
  automationFeedback: AutomationReviewResolution | null;
  publicationFeedback: string | null;
  bulkReport: BulkOperationReport | null;
  bulkReportHistory: BulkOperationHistoryItem[];
  reviewQueue: MonthlyContentPlan["items"];
  readyQueue: MonthlyContentPlan["items"];
  failedQueue: MonthlyContentPlan["items"];
  publishedQueue: MonthlyContentPlan["items"];
  onRunAutomation: () => void;
  onApproveReview: (planItemId: string) => void;
  onRetryPlanItem: (planItemId: string) => void;
  onRetryPublication: (publicationId: string) => void;
  onBulkApproveReview: (planItemIds: string[]) => void;
  onBulkRetryPlanItems: (planItemIds: string[]) => void;
  onBulkRetryPublications: (publicationIds: string[]) => void;
};

export function OperationsBoard(props: Props) {
  const {
    projectId,
    contentPlan,
    publications,
    failedPublications,
    publishedPublications,
    readiness,
    automationBusy,
    automationRun,
    automationFeedback,
    publicationFeedback,
    bulkReport,
    bulkReportHistory,
    reviewQueue,
    readyQueue,
    failedQueue,
    publishedQueue,
    onRunAutomation,
    onApproveReview,
    onRetryPlanItem,
    onRetryPublication,
    onBulkApproveReview,
    onBulkRetryPlanItems,
    onBulkRetryPublications,
  } = props;
  const [operationsFilter, setOperationsFilter] = useState<OperationsFilter>("actionable");
  const [operationsSort, setOperationsSort] = useState<OperationsSort>("priority");
  const [focusedTargetId, setFocusedTargetId] = useState<string | null>(null);
  const [expandedHistoryItemKey, setExpandedHistoryItemKey] = useState<string | null>(null);
  const [contentJobDetails, setContentJobDetails] = useState<Record<string, ContentJobDetail>>({});
  const [contentJobDetailBusy, setContentJobDetailBusy] = useState<Record<string, boolean>>({});
  const [assetDrafts, setAssetDrafts] = useState<
    Record<
      string,
      {
        title: string;
        body: string;
        cta: string;
        hashtags: string;
      }
    >
  >({});
  const [assetSaveBusy, setAssetSaveBusy] = useState<Record<string, boolean>>({});
  const [assetImageBusy, setAssetImageBusy] = useState<Record<string, boolean>>({});
  const operationsViewStorageKey = projectId ? `${OPERATIONS_VIEW_STORAGE_KEY}:${projectId}` : OPERATIONS_VIEW_STORAGE_KEY;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(operationsViewStorageKey);
      if (!stored) {
        setOperationsFilter("actionable");
        setOperationsSort("priority");
        return;
      }

      const parsed = JSON.parse(stored) as {
        filter?: OperationsFilter;
        sort?: OperationsSort;
      };

      setOperationsFilter(parsed.filter ?? "actionable");
      setOperationsSort(parsed.sort ?? "priority");
    } catch {
      setOperationsFilter("actionable");
      setOperationsSort("priority");
    }
  }, [operationsViewStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      operationsViewStorageKey,
      JSON.stringify({
        filter: operationsFilter,
        sort: operationsSort,
      }),
    );
  }, [operationsFilter, operationsSort, operationsViewStorageKey]);

  const readinessStatusLabel =
    readiness?.status === "blocked" ? "즉시 보완 필요" : readiness?.status === "warning" ? "설정 점검 필요" : "자동화 준비 완료";

  function getReadinessSeverityLabel(severity: "blocking" | "warning" | "info") {
    if (severity === "blocking") {
      return "차단";
    }
    if (severity === "warning") {
      return "경고";
    }
    return "정보";
  }

  function getReadinessSeverityClassName(severity: "blocking" | "warning" | "info") {
    if (severity === "blocking") {
      return "readiness-severity blocking";
    }
    if (severity === "warning") {
      return "readiness-severity warning";
    }
    return "readiness-severity info";
  }

  function getReadinessAreaLabel(
    area: "context" | "analytics" | "meta" | "images" | "automation" | "operations",
  ) {
    switch (area) {
      case "context":
        return "콘텍스트";
      case "analytics":
        return "분석";
      case "meta":
        return "Meta";
      case "images":
        return "이미지";
      case "automation":
        return "자동화";
      case "operations":
        return "운영";
      default:
        return area;
    }
  }

  function getTimestamp(value?: string | null) {
    if (!value) {
      return Number.MAX_SAFE_INTEGER;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }

  function sortPlanItems(items: MonthlyContentPlan["items"]) {
    const next = [...items];

    if (operationsSort === "scheduled" || operationsSort === "priority") {
      return next.sort((left, right) => {
        const publishDelta = getTimestamp(left.publishAt) - getTimestamp(right.publishAt);
        if (publishDelta !== 0) {
          return publishDelta;
        }
        return getTimestamp(left.lastProcessedAt) - getTimestamp(right.lastProcessedAt);
      });
    }

    if (operationsSort === "oldest") {
      return next.sort((left, right) => getTimestamp(left.lastProcessedAt) - getTimestamp(right.lastProcessedAt));
    }

    return next.sort((left, right) => getTimestamp(right.lastProcessedAt) - getTimestamp(left.lastProcessedAt));
  }

  function sortPublications(items: ChannelPublicationSummary[]) {
    const next = [...items];

    if (operationsSort === "oldest") {
      return next.sort(
        (left, right) => getTimestamp(left.publishedAt || left.createdAt) - getTimestamp(right.publishedAt || right.createdAt),
      );
    }

    if (operationsSort === "scheduled") {
      return next.sort((left, right) => getTimestamp(left.createdAt) - getTimestamp(right.createdAt));
    }

    return next.sort(
      (left, right) => getTimestamp(right.publishedAt || right.createdAt) - getTimestamp(left.publishedAt || left.createdAt),
    );
  }

  const visibleReviewQueue = sortPlanItems(reviewQueue);
  const visibleReadyQueue = sortPlanItems(readyQueue);
  const visibleFailedQueue = sortPlanItems(failedQueue);
  const visiblePublishedQueue = sortPlanItems(publishedQueue);
  const visibleFailedPublications = sortPublications(failedPublications);
  const visiblePublishedPublications = sortPublications(publishedPublications);

  const showReviewQueue = operationsFilter === "all" || operationsFilter === "actionable" || operationsFilter === "needs_review";
  const showReadyQueue = operationsFilter === "all" || operationsFilter === "actionable" || operationsFilter === "ready_to_publish";
  const showFailedQueue = operationsFilter === "all" || operationsFilter === "actionable" || operationsFilter === "failed";
  const showPublishedQueue = operationsFilter === "all" || operationsFilter === "published";
  const showFailedPublications = operationsFilter === "all" || operationsFilter === "actionable" || operationsFilter === "channel_failed";
  const showPublishedPublications = operationsFilter === "all" || operationsFilter === "channel_published";

  function formatDuration(durationMs?: number | null) {
    if (!durationMs || durationMs < 1000) {
      return durationMs ? `${durationMs}ms` : "0ms";
    }

    const seconds = durationMs / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }

    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }

  function isPublicationHistoryKind(kind: BulkOperationHistoryItem["kind"]) {
    return kind === "publication_retry" || kind === "publication_retry_single";
  }

  function getPlanItemById(planItemId: string) {
    return (
      reviewQueue.find((item) => item.id === planItemId) ||
      failedQueue.find((item) => item.id === planItemId) ||
      readyQueue.find((item) => item.id === planItemId) ||
      publishedQueue.find((item) => item.id === planItemId) ||
      null
    );
  }

  function getPublicationById(publicationId: string) {
    return (
      failedPublications.find((item) => item.id === publicationId) ||
      publishedPublications.find((item) => item.id === publicationId) ||
      publications.find((item) => item.id === publicationId) ||
      null
    );
  }

  function jumpToHistoryItem(kind: BulkOperationHistoryItem["kind"], itemId: string) {
    const targetId = isPublicationHistoryKind(kind) ? `publication-${itemId}` : `plan-item-${itemId}`;
    setOperationsFilter("all");
    setFocusedTargetId(targetId);

    window.setTimeout(() => {
      const element = document.getElementById(targetId);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    window.setTimeout(() => {
      setFocusedTargetId((current) => (current === targetId ? null : current));
    }, 2400);
  }

  function getItemHighlightStyle(targetId: string) {
    if (focusedTargetId !== targetId) {
      return undefined;
    }

    return {
      outline: "2px solid rgba(245, 158, 11, 0.9)",
      outlineOffset: 2,
      boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.18)",
    } as const;
  }

  function toggleHistoryDetail(reportId: string, itemId: string) {
    const nextKey = `${reportId}:${itemId}`;
    setExpandedHistoryItemKey((current) => (current === nextKey ? null : nextKey));
  }

  function getContentJobIdForHistoryItem(report: BulkOperationHistoryItem, itemId: string) {
    if (isPublicationHistoryKind(report.kind)) {
      return getPublicationById(itemId)?.contentJobId || null;
    }

    return getPlanItemById(itemId)?.contentJobId || null;
  }

  async function ensureContentJobDetail(contentJobId: string) {
    if (!projectId || contentJobDetails[contentJobId] || contentJobDetailBusy[contentJobId]) {
      return;
    }

    setContentJobDetailBusy((current) => ({ ...current, [contentJobId]: true }));

    try {
      const data = await apiGet<{ contentJob: ContentJobDetail }>(`/api/projects/${projectId}/content-jobs/${contentJobId}`);
      setContentJobDetails((current) => ({ ...current, [contentJobId]: data.contentJob }));
      setAssetDrafts((current) => {
        const next = { ...current };
        data.contentJob.assets.forEach((asset) => {
          next[asset.id] = {
            title: asset.title || "",
            body: asset.body,
            cta: asset.cta || "",
            hashtags: asset.hashtags || "",
          };
        });
        return next;
      });
    } finally {
      setContentJobDetailBusy((current) => ({ ...current, [contentJobId]: false }));
    }
  }

  async function saveAssetDraft(contentJobId: string, assetId: string) {
    if (!projectId || !assetDrafts[assetId]) {
      return;
    }

    setAssetSaveBusy((current) => ({ ...current, [assetId]: true }));

    try {
      const draft = assetDrafts[assetId];
      const data = await apiPatch<{ contentJob: ContentJobDetail }>(
        `/api/projects/${projectId}/content-jobs/${contentJobId}/assets/${assetId}`,
        draft,
      );
      setContentJobDetails((current) => ({ ...current, [contentJobId]: data.contentJob }));
    } finally {
      setAssetSaveBusy((current) => ({ ...current, [assetId]: false }));
    }
  }

  async function selectAssetImage(contentJobId: string, assetId: string, imageAssetId: string) {
    if (!projectId) {
      return;
    }

    setAssetImageBusy((current) => ({ ...current, [assetId]: true }));

    try {
      const data = await apiPatch<{ contentJob: ContentJobDetail }>(
        `/api/projects/${projectId}/content-jobs/${contentJobId}/assets/${assetId}`,
        { imageAssetId },
      );
      setContentJobDetails((current) => ({ ...current, [contentJobId]: data.contentJob }));
    } finally {
      setAssetImageBusy((current) => ({ ...current, [assetId]: false }));
    }
  }

  function renderContentJobAssets(contentJobDetail: ContentJobDetail) {
    return (
      <div className="stack" style={{ gap: 10, marginTop: 6 }}>
        <span className="fine-print">콘텐츠 주제 {contentJobDetail.topic}</span>
        {contentJobDetail.assets.map((asset) => {
          const draft = assetDrafts[asset.id] || {
            title: asset.title || "",
            body: asset.body,
            cta: asset.cta || "",
            hashtags: asset.hashtags || "",
          };

          return (
            <div key={asset.id} className="review-item">
              <div className="stack" style={{ gap: 6 }}>
                <strong>{asset.channel}{asset.title ? ` · ${asset.title}` : ""}</strong>
                <input
                  className="text-input"
                  value={draft.title}
                  placeholder="제목"
                  onChange={(e) =>
                    setAssetDrafts((current) => ({
                      ...current,
                      [asset.id]: { ...draft, title: e.target.value },
                    }))
                  }
                />
                <textarea
                  className="text-input"
                  value={draft.body}
                  rows={6}
                  onChange={(e) =>
                    setAssetDrafts((current) => ({
                      ...current,
                      [asset.id]: { ...draft, body: e.target.value },
                    }))
                  }
                />
                <input
                  className="text-input"
                  value={draft.cta}
                  placeholder="CTA"
                  onChange={(e) =>
                    setAssetDrafts((current) => ({
                      ...current,
                      [asset.id]: { ...draft, cta: e.target.value },
                    }))
                  }
                />
                <input
                  className="text-input"
                  value={draft.hashtags}
                  placeholder="#hashtag, #campaign"
                  onChange={(e) =>
                    setAssetDrafts((current) => ({
                      ...current,
                      [asset.id]: { ...draft, hashtags: e.target.value },
                    }))
                  }
                />
                <div className="button-row">
                  <button
                    className="button ghost"
                    disabled={assetSaveBusy[asset.id] || automationBusy}
                    onClick={() => void saveAssetDraft(contentJobDetail.id, asset.id)}
                  >
                    {assetSaveBusy[asset.id] ? "저장 중…" : "자산 저장"}
                  </button>
                </div>
                {asset.images.length > 0 ? (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {asset.images.map((image) => (
                      <button
                        key={image.id}
                        className="button ghost"
                        disabled={assetImageBusy[asset.id] || automationBusy}
                        style={{ padding: 6, borderColor: image.selected ? "#f59e0b" : undefined }}
                        onClick={() => void selectAssetImage(contentJobDetail.id, asset.id, image.id)}
                      >
                        <img
                          src={image.url}
                          alt={`${asset.channel}-${image.role}`}
                          style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, display: "block" }}
                        />
                        <span className="fine-print">{image.selected ? "대표 이미지" : image.role}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderHistoryDetail(report: BulkOperationHistoryItem, itemId: string) {
    const contentJobId = getContentJobIdForHistoryItem(report, itemId);
    const contentJobDetail = contentJobId ? contentJobDetails[contentJobId] : null;

    if (isPublicationHistoryKind(report.kind)) {
      const publication = getPublicationById(itemId);

      if (!publication) {
        return <span className="fine-print">현재 운영 큐에서 이 채널 이력을 찾지 못했습니다.</span>;
      }

      return (
        <div className="stack" style={{ gap: 6 }}>
          <span className="fine-print">채널 {publication.channel} · 제공자 {publication.provider}</span>
          <span className="fine-print">상태 {publication.status}</span>
          {publication.payloadSummary ? <span className="fine-print">요약 {publication.payloadSummary}</span> : null}
          {publication.errorMessage ? <span className="fine-print error-text">오류 {publication.errorMessage}</span> : null}
          {publication.externalPostUrl ? (
            <a className="fine-print" href={publication.externalPostUrl} target="_blank" rel="noreferrer">
              {publication.externalPostUrl}
            </a>
          ) : null}
          {contentJobId ? (
            contentJobDetail ? (
              renderContentJobAssets(contentJobDetail)
            ) : contentJobDetailBusy[contentJobId] ? (
              <span className="fine-print">콘텐츠 자산을 불러오는 중…</span>
            ) : (
              <span className="fine-print">콘텐츠 자산을 불러오지 못했습니다.</span>
            )
          ) : null}
        </div>
      );
    }

    const planItem = getPlanItemById(itemId);

    if (!planItem) {
      return <span className="fine-print">현재 운영 큐에서 이 계획 항목을 찾지 못했습니다.</span>;
    }

    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="fine-print">주차 {planItem.weekLabel} · 상태 {planItem.status}</span>
        {planItem.publishAt ? <span className="fine-print">예약 {new Date(planItem.publishAt).toLocaleString("ko-KR")}</span> : null}
        {planItem.lastProcessedAt ? <span className="fine-print">마지막 처리 {new Date(planItem.lastProcessedAt).toLocaleString("ko-KR")}</span> : null}
        {planItem.rationale ? <span className="fine-print">기획 근거 {planItem.rationale}</span> : null}
        {planItem.lastError ? <span className="fine-print error-text">오류 {planItem.lastError}</span> : null}
        {planItem.reviewSnapshot ? (
          <div className="stack" style={{ gap: 4 }}>
            <span className="fine-print">
              리뷰 종합 {planItem.reviewSnapshot.averageScore}점 / 리스크 {planItem.reviewSnapshot.scores.riskControl}점
            </span>
            <span className="fine-print">
              브랜드 {planItem.reviewSnapshot.scores.brandAlignment} · 포맷 {planItem.reviewSnapshot.scores.formatFit} · CTA {planItem.reviewSnapshot.scores.ctaClarity}
            </span>
            {planItem.reviewSnapshot.findings.slice(0, 4).map((finding, index) => (
              <span key={`${planItem.id}-detail-${finding.channel}-${finding.type}-${index}`} className={`fine-print ${finding.severity === "warning" ? "error-text" : ""}`}>
                {finding.channel} · {finding.type} · {finding.message}
              </span>
            ))}
          </div>
        ) : null}
        {contentJobId ? (
          contentJobDetail ? (
            renderContentJobAssets(contentJobDetail)
          ) : contentJobDetailBusy[contentJobId] ? (
            <span className="fine-print">콘텐츠 자산을 불러오는 중…</span>
          ) : (
            <span className="fine-print">콘텐츠 자산을 불러오지 못했습니다.</span>
          )
        ) : null}
      </div>
    );
  }

  function renderHistoryActions(report: BulkOperationHistoryItem, itemId: string) {
    if (isPublicationHistoryKind(report.kind)) {
      const publication = getPublicationById(itemId);

      if (publication?.status === "failed") {
        return (
          <div className="button-row">
            <button className="button ghost" disabled={automationBusy} onClick={() => onRetryPublication(itemId)}>
              채널 재시도
            </button>
          </div>
        );
      }

      return null;
    }

    const planItem = getPlanItemById(itemId);

    if (!planItem) {
      return null;
    }

    if (planItem.status === "needs_review") {
      return (
        <div className="button-row">
          <button className="button primary" disabled={automationBusy} onClick={() => onApproveReview(itemId)}>
            승인 후 게시
          </button>
          <button className="button ghost" disabled={automationBusy} onClick={() => onRetryPlanItem(itemId)}>
            다시 실행
          </button>
        </div>
      );
    }

    if (planItem.status === "failed") {
      return (
        <div className="button-row">
          <button className="button ghost" disabled={automationBusy} onClick={() => onRetryPlanItem(itemId)}>
            다시 실행
          </button>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="sb-section-body">
      <div className="sb-form" style={{ marginBottom: 16 }}>
        <div className="operations-plan-summary">
          <div className="operations-plan-summary-header">
            <div>
              <strong>{contentPlan ? `${contentPlan.monthKey} 월간 계획` : "월간 계획 없음"}</strong>
              <p className="fine-print">
                {contentPlan
                  ? `계획 항목 ${contentPlan.items.length}건 · 상태 ${contentPlan.status}${contentPlan.generatedAt ? ` · 생성 ${new Date(contentPlan.generatedAt).toLocaleString("ko-KR")}` : ""}`
                  : "먼저 월간 계획을 생성하면 주차별 주제와 실행 큐가 이 영역에 표시됩니다."}
              </p>
            </div>
          </div>
          {contentPlan?.basisSummary ? (
            <p className="fine-print">{contentPlan.basisSummary}</p>
          ) : null}
          {contentPlan?.items.length ? (
            <div className="operations-plan-items">
              {contentPlan.items.slice(0, 6).map((item) => (
                <div key={item.id} className="operations-plan-item">
                  <strong>{item.weekLabel}</strong>
                  <span>{item.topic}</span>
                  <p className="fine-print">
                    {item.publishAt ? `예약 ${new Date(item.publishAt).toLocaleString("ko-KR")} · ` : ""}
                    상태 {item.status}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="button-row operations-primary-actions">
          <button className="button primary" disabled={automationBusy} onClick={onRunAutomation}>
            {automationBusy ? "자동 실행 중…" : "이 프로젝트 자동 실행"}
          </button>
          <a className="button ghost" href={projectId ? `/studio/settings?projectId=${projectId}` : "/studio/settings"}>
            설정 열기
          </a>
        </div>
        <div className="field-grid-2" style={{ marginTop: 12 }}>
          <div className="field-group">
            <label className="field-label">필터</label>
            <select className="text-input" value={operationsFilter} onChange={(e) => setOperationsFilter(e.target.value as OperationsFilter)}>
              <option value="actionable">우선 처리</option>
              <option value="all">전체</option>
              <option value="needs_review">검토 필요</option>
              <option value="ready_to_publish">발행 대기</option>
              <option value="failed">실패</option>
              <option value="published">게시 완료</option>
              <option value="channel_failed">채널 실패</option>
              <option value="channel_published">채널 게시</option>
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">정렬</label>
            <select className="text-input" value={operationsSort} onChange={(e) => setOperationsSort(e.target.value as OperationsSort)}>
              <option value="priority">우선순위</option>
              <option value="scheduled">예약순</option>
              <option value="recent">최근순</option>
              <option value="oldest">오래된순</option>
            </select>
          </div>
        </div>
        <p className="fine-print">자동화 정책과 채널 정보 수정은 설정 화면에서만 관리합니다. 운영보드에서는 계획 실행, 검토, 재시도 상태만 처리합니다.</p>
      </div>
      {readiness ? (
        <div className="stack" style={{ marginBottom: 16 }}>
          <div className={`readiness-summary ${readiness.status}`}>
            <div>
              <strong>{readinessStatusLabel}</strong>
              <p className="fine-print">
                마지막 점검 {new Date(readiness.generatedAt).toLocaleString("ko-KR")} 기준으로 현재 자동화 운영 상태를 정리했습니다.
              </p>
            </div>
            <div className="readiness-summary-metrics">
              <div className="readiness-metric">
                <span>차단</span>
                <strong>{readiness.blockingCount}건</strong>
              </div>
              <div className="readiness-metric">
                <span>경고</span>
                <strong>{readiness.warningCount}건</strong>
              </div>
              <div className="readiness-metric">
                <span>정보</span>
                <strong>{readiness.infoCount}건</strong>
              </div>
            </div>
          </div>
          <div className="readiness-issue-list">
            {readiness.issues.slice(0, 6).map((issue) => (
              <div key={issue.id} className="readiness-issue-card">
                <div className="readiness-issue-header">
                  <span className={getReadinessSeverityClassName(issue.severity)}>
                    {getReadinessSeverityLabel(issue.severity)}
                  </span>
                  <span className="readiness-area-chip">{getReadinessAreaLabel(issue.area)}</span>
                </div>
                <strong className={issue.severity === "blocking" ? "error-text" : ""}>{issue.title}</strong>
                <span className="fine-print">{issue.detail}</span>
                {issue.recommendation ? (
                  <div className="readiness-recommendation">
                    <span>권장 조치</span>
                    <p className="fine-print">{issue.recommendation}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {automationRun ? (
        <div className="review-item" style={{ marginTop: 12 }}>
          <strong>{new Date(automationRun.executedAt).toLocaleString("ko-KR")}</strong>
          <span className="fine-print">
            총 {automationRun.total}건 · 게시 {automationRun.published} · 준비 {automationRun.readyToPublish} · 검토 필요 {automationRun.needsReview} · 실패 {automationRun.failed}
          </span>
        </div>
      ) : null}
      {automationFeedback ? (
        <div className="review-item" style={{ marginTop: 12 }}>
          <strong>{automationFeedback.action === "approve" ? "검토 승인" : "재실행"} 완료</strong>
          <span className="fine-print">{automationFeedback.message}</span>
        </div>
      ) : null}
      {publicationFeedback ? (
        <div className="review-item" style={{ marginTop: 12 }}>
          <strong>채널 재시도 완료</strong>
          <span className="fine-print">{publicationFeedback}</span>
        </div>
      ) : null}
      {bulkReport ? (
        <div className="review-item" style={{ marginTop: 12 }}>
          <strong>{bulkReport.label}</strong>
          <span className="fine-print">
            성공 {bulkReport.completed}건 · 실패 {bulkReport.failed}건
          </span>
          <div className="stack" style={{ marginTop: 8 }}>
            {bulkReport.items.slice(0, 8).map((item) => (
              <span key={item.id} className={`fine-print ${item.status === "failed" ? "error-text" : ""}`}>
                {item.label} · {item.status === "success" ? "성공" : "실패"} · {item.message}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {bulkReportHistory.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <strong>{`최근 일괄 처리 이력 ${bulkReportHistory.length}건`}</strong>
          {bulkReportHistory.slice(0, 5).map((report) => (
            <div key={report.id} className="review-item">
              <strong>{report.label}</strong>
              <span className="fine-print">
                {new Date(report.createdAt).toLocaleString("ko-KR")} · 성공 {report.completed}건 · 실패 {report.failed}건
              </span>
              <span className="fine-print">
                실행자 {report.actorLabel || "operator"} · 경로 {report.executionSource || "studio"} · 소요 {formatDuration(report.durationMs)}
              </span>
              <div className="stack" style={{ marginTop: 8 }}>
                {report.items.slice(0, 4).map((item) => (
                  <div key={`${report.id}-${item.id}`} className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <span className={`fine-print ${item.status === "failed" ? "error-text" : ""}`}>
                        {item.label} · {item.status === "success" ? "성공" : "실패"} · {item.message}
                      </span>
                      <div className="button-row">
                        <button
                          className="button ghost"
                          onClick={() => {
                            const nextKey = `${report.id}:${item.id}`;
                            const willExpand = expandedHistoryItemKey !== nextKey;
                            toggleHistoryDetail(report.id, item.id);
                            if (willExpand) {
                              const contentJobId = getContentJobIdForHistoryItem(report, item.id);
                              if (contentJobId) {
                                void ensureContentJobDetail(contentJobId);
                              }
                            }
                          }}
                        >
                          {expandedHistoryItemKey === `${report.id}:${item.id}` ? "상세 닫기" : "상세 보기"}
                        </button>
                        <button className="button ghost" onClick={() => jumpToHistoryItem(report.kind, item.id)}>
                          항목 보기
                        </button>
                      </div>
                    </div>
                    {expandedHistoryItemKey === `${report.id}:${item.id}` ? (
                      <div className="review-item" style={{ marginTop: 4 }}>
                        {renderHistoryDetail(report, item.id)}
                      </div>
                    ) : null}
                    {renderHistoryActions(report, item.id)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showReviewQueue && visibleReviewQueue.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{`검토 큐 ${visibleReviewQueue.length}건`}</strong>
            <div className="button-row">
              <button className="button primary" disabled={automationBusy} onClick={() => onBulkApproveReview(visibleReviewQueue.map((item) => item.id))}>
                전체 승인
              </button>
              <button className="button ghost" disabled={automationBusy} onClick={() => onBulkRetryPlanItems(visibleReviewQueue.map((item) => item.id))}>
                전체 재실행
              </button>
            </div>
          </div>
          {visibleReviewQueue.map((reviewItem) => (
            <div key={reviewItem.id} id={`plan-item-${reviewItem.id}`} className="review-item" style={getItemHighlightStyle(`plan-item-${reviewItem.id}`)}>
              <strong>{reviewItem.weekLabel} · {reviewItem.topic}</strong>
              <span className="fine-print">상태 {reviewItem.status} · 시도 {reviewItem.attemptCount}회</span>
              {reviewItem.lastError ? <span className="fine-print error-text">{reviewItem.lastError}</span> : null}
              {reviewItem.reviewSnapshot ? (
                <div className="stack" style={{ marginTop: 8 }}>
                  <span className="fine-print">
                    종합 {reviewItem.reviewSnapshot.averageScore}점 / 기준 {reviewItem.reviewSnapshot.minOverallScore}점
                  </span>
                  <span className="fine-print">
                    리스크 {reviewItem.reviewSnapshot.scores.riskControl}점 / 기준 {reviewItem.reviewSnapshot.minRiskScore}점
                  </span>
                  <span className="fine-print">
                    브랜드 {reviewItem.reviewSnapshot.scores.brandAlignment} · 포맷 {reviewItem.reviewSnapshot.scores.formatFit} · CTA {reviewItem.reviewSnapshot.scores.ctaClarity}
                  </span>
                  {reviewItem.reviewSnapshot.findings.slice(0, 4).map((finding, index) => (
                    <span key={`${reviewItem.id}-${finding.channel}-${finding.type}-${index}`} className={`fine-print ${finding.severity === "warning" ? "error-text" : ""}`}>
                      {finding.channel} · {finding.type} · {finding.message}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="button-row" style={{ marginTop: 8 }}>
                <button className="button primary" disabled={automationBusy} onClick={() => onApproveReview(reviewItem.id)}>
                  승인 후 게시
                </button>
                <button className="button ghost" disabled={automationBusy} onClick={() => onRetryPlanItem(reviewItem.id)}>
                  다시 실행
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showReadyQueue && visibleReadyQueue.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <strong>{`발행 대기 큐 ${visibleReadyQueue.length}건`}</strong>
          {visibleReadyQueue.map((queueItem) => (
            <div key={queueItem.id} id={`plan-item-${queueItem.id}`} className="review-item" style={getItemHighlightStyle(`plan-item-${queueItem.id}`)}>
              <strong>{queueItem.weekLabel} · {queueItem.topic}</strong>
              <span className="fine-print">
                상태 {queueItem.status}
                {queueItem.publishAt ? ` · 예약 ${queueItem.publishAt.slice(5, 16).replace("T", " ")}` : ""}
              </span>
              <span className="fine-print">
                시도 {queueItem.attemptCount}회
                {queueItem.contentJobId ? ` · 콘텐츠 연결됨` : ""}
              </span>
              {queueItem.lastProcessedAt ? (
                <span className="fine-print">마지막 처리 {new Date(queueItem.lastProcessedAt).toLocaleString("ko-KR")}</span>
              ) : null}
              {queueItem.reviewSnapshot ? (
                <div className="stack" style={{ marginTop: 8 }}>
                  <span className="fine-print">
                    종합 {queueItem.reviewSnapshot.averageScore}점 · 리스크 {queueItem.reviewSnapshot.scores.riskControl}점
                  </span>
                  <span className="fine-print">
                    브랜드 {queueItem.reviewSnapshot.scores.brandAlignment} · 포맷 {queueItem.reviewSnapshot.scores.formatFit} · CTA {queueItem.reviewSnapshot.scores.ctaClarity}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {showFailedQueue && visibleFailedQueue.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{`실패 큐 ${visibleFailedQueue.length}건`}</strong>
            <button className="button ghost" disabled={automationBusy} onClick={() => onBulkRetryPlanItems(visibleFailedQueue.map((item) => item.id))}>
              전체 재실행
            </button>
          </div>
          {visibleFailedQueue.map((queueItem) => (
            <div key={queueItem.id} id={`plan-item-${queueItem.id}`} className="review-item" style={getItemHighlightStyle(`plan-item-${queueItem.id}`)}>
              <strong>{queueItem.weekLabel} · {queueItem.topic}</strong>
              <span className="fine-print">
                상태 {queueItem.status}
                {queueItem.publishAt ? ` · 예약 ${queueItem.publishAt.slice(5, 16).replace("T", " ")}` : ""}
              </span>
              {queueItem.lastError ? <span className="fine-print error-text">{queueItem.lastError}</span> : null}
              {queueItem.lastProcessedAt ? (
                <span className="fine-print">마지막 처리 {new Date(queueItem.lastProcessedAt).toLocaleString("ko-KR")}</span>
              ) : null}
              <div className="button-row" style={{ marginTop: 8 }}>
                <button className="button ghost" disabled={automationBusy} onClick={() => onRetryPlanItem(queueItem.id)}>
                  실패 항목 재실행
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showPublishedQueue && visiblePublishedQueue.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <strong>{`최근 게시 완료 ${visiblePublishedQueue.length}건`}</strong>
          {visiblePublishedQueue.map((queueItem) => (
            <div key={queueItem.id} id={`plan-item-${queueItem.id}`} className="review-item" style={getItemHighlightStyle(`plan-item-${queueItem.id}`)}>
              <strong>{queueItem.weekLabel} · {queueItem.topic}</strong>
              <span className="fine-print">
                상태 {queueItem.status}
                {queueItem.lastProcessedAt ? ` · 완료 ${new Date(queueItem.lastProcessedAt).toLocaleString("ko-KR")}` : ""}
              </span>
              {queueItem.contentJobId ? <span className="fine-print">콘텐츠 연결됨</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {showFailedPublications && visibleFailedPublications.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{`채널 실패 이력 ${visibleFailedPublications.length}건`}</strong>
            <button className="button ghost" disabled={automationBusy} onClick={() => onBulkRetryPublications(visibleFailedPublications.map((item) => item.id))}>
              전체 채널 재시도
            </button>
          </div>
          {visibleFailedPublications.map((publication) => (
            <div key={publication.id} id={`publication-${publication.id}`} className="review-item" style={getItemHighlightStyle(`publication-${publication.id}`)}>
              <strong>{publication.channel} · {publication.provider}</strong>
              <span className="fine-print">
                실패
                {publication.createdAt ? ` · ${new Date(publication.createdAt).toLocaleString("ko-KR")}` : ""}
              </span>
              {publication.failureCategory ? <span className="fine-print">유형 {publication.failureCategory}</span> : null}
              {publication.errorMessage ? <span className="fine-print error-text">{publication.errorMessage}</span> : null}
              <div className="button-row" style={{ marginTop: 8 }}>
                <button className="button ghost" disabled={automationBusy} onClick={() => onRetryPublication(publication.id)}>
                  채널 재시도
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showPublishedPublications && visiblePublishedPublications.length > 0 ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <strong>{`최근 채널 게시 ${visiblePublishedPublications.length}건`}</strong>
          {visiblePublishedPublications.map((publication) => (
            <div key={publication.id} id={`publication-${publication.id}`} className="review-item" style={getItemHighlightStyle(`publication-${publication.id}`)}>
              <strong>{publication.channel} · {publication.provider}</strong>
              <span className="fine-print">
                {publication.status}
                {publication.publishedAt ? ` · ${new Date(publication.publishedAt).toLocaleString("ko-KR")}` : ""}
              </span>
              {publication.failureCategory ? <span className="fine-print">유형 {publication.failureCategory}</span> : null}
              {publication.externalPostUrl ? (
                <a className="fine-print" href={publication.externalPostUrl} target="_blank" rel="noreferrer">
                  {publication.externalPostUrl}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="stack" style={{ marginTop: 12 }}>
        {publications.length === 0 ? (
          <p className="fine-print">아직 채널 게시 이력이 없습니다.</p>
        ) : (
          publications.slice(0, 8).map((publication) => (
            <div key={publication.id} id={`publication-${publication.id}`} className="review-item" style={getItemHighlightStyle(`publication-${publication.id}`)}>
              <strong>{publication.channel} · {publication.provider}</strong>
              <span className="fine-print">
                {publication.status}
                {publication.publishedAt ? ` · ${new Date(publication.publishedAt).toLocaleString("ko-KR")}` : ""}
              </span>
              {publication.failureCategory ? <span className="fine-print">유형 {publication.failureCategory}</span> : null}
              {publication.externalPostUrl ? (
                <a className="fine-print" href={publication.externalPostUrl} target="_blank" rel="noreferrer">
                  {publication.externalPostUrl}
                </a>
              ) : null}
              {publication.errorMessage ? <span className="fine-print error-text">{publication.errorMessage}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
