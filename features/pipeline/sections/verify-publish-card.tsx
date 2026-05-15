"use client";

import { SectionCard } from "@/components/ui/section-card";
import { SectionLockOverlay } from "../components/section-lock-overlay";
import type {
  StudioDetail,
  ExportPreviewState,
  BlogPublishPackage,
  BlogPublishDraft,
  WordPressPublishConfig,
  WordPressPublishResult,
  ChannelKey,
} from "../types";

type Props = {
  locked: boolean;
  studio: StudioDetail | null;
  // Export
  exportBusy: boolean;
  exportPreview: ExportPreviewState;
  onExportChannel: (ch: ChannelKey) => void;
  onExportAll: () => void;
  onCopyExportPreview: () => void;
  onDownloadExportContent: () => void;
  onDownloadExportHashtags: () => void;
  onExportPreviewViewChange: (view: ChannelKey | "json") => void;
  copyBusy: boolean;
  copyStatus: string | null;
  // Publish
  publishBusy: boolean;
  publishPackage: BlogPublishPackage | null;
  publishDraft: BlogPublishDraft;
  onPublishDraftChange: (field: keyof BlogPublishDraft, value: string) => void;
  onCopyBlogPublishHtml: () => void;
  onPreparePublish: () => void;
  // WordPress
  wordpressResult: WordPressPublishResult | null;
  wordpressConfig: WordPressPublishConfig;
  onWordPressConfigChange: (field: keyof WordPressPublishConfig, value: string) => void;
  settingsBusy: boolean;
  onSaveWordPressDefaults: () => void;
};

export function VerifyPublishCard(props: Props) {
  const {
    locked, studio,
    exportBusy, exportPreview,
    onExportChannel, onExportAll,
    onCopyExportPreview, onDownloadExportContent, onDownloadExportHashtags,
    onExportPreviewViewChange,
    copyBusy, copyStatus,
    publishBusy, publishPackage, publishDraft,
    onPublishDraftChange, onCopyBlogPublishHtml, onPreparePublish,
    wordpressResult, wordpressConfig, onWordPressConfigChange,
    settingsBusy, onSaveWordPressDefaults,
  } = props;

  const review = studio?.review;
  const scores = review?.scores;

  return (
    <div className="pipeline-section">
      <SectionCard title="검증 · 발행" description="AI 리뷰 스코어 확인 후 내보내기 또는 WordPress 발행">
        {locked && <SectionLockOverlay message="콘텐츠가 필요합니다." />}

        <div className="wizard-stage">
          {/* Review scores */}
          {scores && (
            <div className="card soft">
              <h4 className="card-title">AI 리뷰 스코어</h4>
              <div className="kpi-grid" style={{ marginTop: 12 }}>
                <div className="kpi-item">
                  <strong>{scores.brandAlignment}</strong>
                  <span className="fine-print">브랜드 정합</span>
                </div>
                <div className="kpi-item">
                  <strong>{scores.formatFit}</strong>
                  <span className="fine-print">포맷 적합</span>
                </div>
                <div className="kpi-item">
                  <strong>{scores.ctaClarity}</strong>
                  <span className="fine-print">CTA 명확도</span>
                </div>
              </div>
              <div className="kpi-grid" style={{ marginTop: 8 }}>
                <div className="kpi-item">
                  <strong>{scores.riskControl}</strong>
                  <span className="fine-print">리스크 제어</span>
                </div>
                <div className="kpi-item">
                  <strong>{review?.status === "ready" ? "통과" : "수정 필요"}</strong>
                  <span className="fine-print">종합</span>
                </div>
              </div>

              {review && review.findings.length > 0 && (
                <details className="inline-details" style={{ marginTop: 12 }}>
                  <summary>리뷰 피드백 ({review.findings.length}건)</summary>
                  <div className="inline-details-body">
                    {review.findings.map((f, i) => (
                      <div key={i} className="review-item">
                        <strong>{f.channel} · {f.type}</strong>
                        <span className={`fine-print ${f.severity === "warning" ? "error-text" : ""}`}>{f.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Export section */}
          <div className="card">
            <h4 className="card-title">내보내기</h4>
            <div className="button-row" style={{ marginTop: 12 }}>
              <button className="button ghost" disabled={exportBusy} onClick={() => onExportChannel("blog")}>
                {exportBusy ? "로드 중…" : "블로그"}
              </button>
              <button className="button ghost" disabled={exportBusy} onClick={() => onExportChannel("instagram")}>
                인스타
              </button>
              <button className="button ghost" disabled={exportBusy} onClick={() => onExportChannel("facebook")}>
                페이스북
              </button>
              <button className="button" disabled={exportBusy} onClick={onExportAll}>
                전체 JSON
              </button>
            </div>

            {exportPreview.bundle && (
              <div className="export-preview-card" style={{ marginTop: 12 }}>
                <div className="export-preview-tabs">
                  {(["blog", "instagram", "facebook", "json"] as const).map((view) => (
                    <button
                      key={view}
                      className={`content-tab ${exportPreview.activeView === view ? "active" : ""}`}
                      onClick={() => onExportPreviewViewChange(view)}
                    >
                      {view === "json" ? "JSON" : view === "blog" ? "블로그" : view === "instagram" ? "인스타" : "페이스북"}
                    </button>
                  ))}
                </div>

                <div className="export-preview-body">
                  {exportPreview.activeView === "json"
                    ? JSON.stringify(exportPreview.bundle, null, 2)
                    : exportPreview.bundle.channels.find((c) => c.channel === exportPreview.activeView)?.content || "(내용 없음)"
                  }
                </div>

                <div className="export-preview-meta">
                  <div className="button-row">
                    <button className="button ghost" disabled={copyBusy} onClick={onCopyExportPreview}>
                      {copyBusy ? "복사 중…" : "복사"}
                    </button>
                    {exportPreview.activeView !== "json" && (
                      <>
                        <button className="button ghost" onClick={onDownloadExportContent}>본문 다운로드</button>
                        <button className="button ghost" onClick={onDownloadExportHashtags}>해시태그 다운로드</button>
                      </>
                    )}
                  </div>
                  {copyStatus && <span className="fine-print">{copyStatus}</span>}
                </div>
              </div>
            )}
          </div>

          {/* WordPress publish */}
          <div className="card">
            <h4 className="card-title">WordPress 발행</h4>

            {wordpressResult && (
              <div className="step-focus-banner" style={{ marginTop: 12 }}>
                <span className="eyebrow">발행 완료</span>
                <p className="fine-print">
                  Post #{wordpressResult.postId} —{" "}
                  <a href={wordpressResult.link} target="_blank" rel="noopener noreferrer">
                    {wordpressResult.link}
                  </a>
                </p>
              </div>
            )}

            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field-grid-2">
                <div className="field-group">
                  <label className="field-label">사이트 URL</label>
                  <input
                    className="text-input"
                    value={wordpressConfig.siteUrl}
                    onChange={(e) => onWordPressConfigChange("siteUrl", e.target.value)}
                    placeholder="https://your-site.com"
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">사용자명</label>
                  <input
                    className="text-input"
                    value={wordpressConfig.username}
                    onChange={(e) => onWordPressConfigChange("username", e.target.value)}
                  />
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">앱 비밀번호</label>
                <input
                  className="text-input"
                  type="password"
                  value={wordpressConfig.appPassword}
                  onChange={(e) => onWordPressConfigChange("appPassword", e.target.value)}
                />
              </div>
              <div className="field-grid-2">
                <div className="field-group">
                  <label className="field-label">카테고리</label>
                  <input
                    className="text-input"
                    value={wordpressConfig.categoryNames}
                    onChange={(e) => onWordPressConfigChange("categoryNames", e.target.value)}
                    placeholder="쉼표로 구분"
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">태그</label>
                  <input
                    className="text-input"
                    value={wordpressConfig.tagNames}
                    onChange={(e) => onWordPressConfigChange("tagNames", e.target.value)}
                    placeholder="쉼표로 구분"
                  />
                </div>
              </div>
            </div>

            {/* Publish draft override */}
            {publishPackage && (
              <details className="inline-details" style={{ marginTop: 12 }}>
                <summary>발행 초안 편집</summary>
                <div className="inline-details-body">
                  <div className="field-group">
                    <label className="field-label">제목</label>
                    <input className="text-input" value={publishDraft.title} onChange={(e) => onPublishDraftChange("title", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">슬러그</label>
                    <input className="text-input" value={publishDraft.slug} onChange={(e) => onPublishDraftChange("slug", e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">요약</label>
                    <textarea className="text-area" value={publishDraft.summary} onChange={(e) => onPublishDraftChange("summary", e.target.value)} rows={2} />
                  </div>
                  <button className="button ghost" disabled={copyBusy} onClick={onCopyBlogPublishHtml}>
                    HTML 복사
                  </button>
                </div>
              </details>
            )}

            <div className="button-row" style={{ marginTop: 16 }}>
              <button
                className="button primary"
                disabled={publishBusy}
                onClick={onPreparePublish}
              >
                {publishBusy ? "발행 처리 중…" : publishPackage ? "WordPress 발행" : "발행 준비"}
              </button>
              <button
                className="button ghost"
                disabled={settingsBusy}
                onClick={onSaveWordPressDefaults}
              >
                {settingsBusy ? "저장 중…" : "WP 설정 저장"}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
