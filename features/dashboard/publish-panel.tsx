import { EmptyStatePanel } from "@/components/ui/empty-state-panel";
import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import type {
  BlogPublishResult,
  BlogPublishDraft,
  BlogPublishPackage,
  ChannelKey,
  ExportPreviewState,
  ProjectActivityItem,
  WordPressPublishConfig,
} from "@/features/dashboard/types";

type PublishPanelProps = {
  activeChannel: ChannelKey;
  copyBusy?: boolean;
  copyStatus?: string | null;
  exportBusy?: boolean;
  publishBusy?: boolean;
  settingsBusy?: boolean;
  exportPreview: ExportPreviewState;
  history: ProjectActivityItem[];
  publishPackage?: BlogPublishPackage | null;
  publishDraft: BlogPublishDraft;
  wordpressConfig: WordPressPublishConfig;
  wordpressResult?: BlogPublishResult | null;
  onChannelChange: (channel: ChannelKey) => void;
  onExportChannel: (channel: ChannelKey) => Promise<void>;
  onExportAll: () => Promise<void>;
  onExportPreviewViewChange: (view: ChannelKey | "json") => void;
  onPreparePublish: () => Promise<void>;
  onPublishNow: () => Promise<void>;
  onSaveWordPressDefaults: () => Promise<void>;
  onCopyExportPreview?: () => Promise<void>;
  onDownloadExportContent?: () => Promise<void>;
  onDownloadExportHashtags?: () => Promise<void>;
  onCopyBlogPublishHtml?: () => Promise<void>;
  onPublishDraftChange: (field: keyof BlogPublishDraft, value: string) => void;
  onWordPressConfigChange: (field: keyof WordPressPublishConfig, value: string) => void;
};

const channelLabels = {
  blog: "블로그",
  instagram: "인스타그램",
  facebook: "페이스북",
} as const;

export function PublishPanel({
  activeChannel,
  copyBusy = false,
  copyStatus = null,
  exportBusy = false,
  publishBusy = false,
  settingsBusy = false,
  exportPreview,
  history,
  publishPackage = null,
  publishDraft,
  wordpressConfig,
  wordpressResult = null,
  onChannelChange,
  onExportChannel,
  onExportAll,
  onExportPreviewViewChange,
  onPreparePublish,
  onPublishNow,
  onSaveWordPressDefaults,
  onCopyExportPreview,
  onDownloadExportContent,
  onDownloadExportHashtags,
  onCopyBlogPublishHtml,
  onPublishDraftChange,
  onWordPressConfigChange,
}: PublishPanelProps) {
  const activeExportChannel =
    exportPreview.activeView === "json"
      ? null
      : exportPreview.bundle?.channels.find((item) => item.channel === exportPreview.activeView) ?? null;

  return (
    <SectionCard
      title="복사 및 발행 준비"
      description="채널별 결과를 미리 보고 바로 복사해 붙여넣거나, 발행 준비 상태로 넘길 수 있습니다. 실제 매체 연동은 이 단계에서 확장합니다."
      badge="Publish"
    >
      <div className="ops-grid">
        <div className="ops-actions">
          <div className="ops-action-guide">
            <strong>지금 할 일</strong>
            <p className="fine-print">
              먼저 채널 하나를 골라 결과를 확인한 뒤 복사해서 바로 쓰세요. 구조 확인이 필요할 때만 전체 JSON 보기를 사용하면 됩니다.
            </p>
          </div>
          <div className="review-item">
            <strong>블로그 게시 설정</strong>
            <p className="fine-print">
              먼저 블로그 등록 패키지를 만들고 제목, slug, excerpt를 검토한 뒤 Blogger로 바로 게시합니다. 인스타그램과 페이스북 탭은 결과 미리보기 확인용입니다.
            </p>
          </div>
          <div className="review-item">
            <strong>Blogger 설정은 전체 설정 메뉴에서 관리합니다.</strong>
            <p className="fine-print">
              Blog ID, Access Token, 게시 상태는 설정 화면에 저장된 값을 그대로 사용합니다. 이 화면에서는 추가 입력 없이 저장된 Blogger 설정으로 바로 발행합니다.
            </p>
          </div>
          <div className="content-tabs">
            {(Object.keys(channelLabels) as Array<keyof typeof channelLabels>).map((channel) => (
              <button
                key={channel}
                className={`content-tab ${activeChannel === channel ? "active" : ""}`}
                type="button"
                onClick={() => onChannelChange(channel)}
              >
                {channelLabels[channel]}
              </button>
            ))}
          </div>
          <button className="button primary" disabled={exportBusy} type="button" onClick={() => void onExportChannel(activeChannel)}>
            {exportBusy ? "미리보기 불러오는 중" : `${channelLabels[activeChannel]} 결과 보기`}
          </button>
          <button className="button ghost" disabled={exportBusy} type="button" onClick={() => void onExportAll()}>
            전체 JSON 보기
          </button>
          <button className="button ghost" disabled={settingsBusy} type="button" onClick={() => void onSaveWordPressDefaults()}>
            {settingsBusy ? "기본값 저장 중" : "발행 기본값 저장"}
          </button>
          <button className="button" disabled={publishBusy} type="button" onClick={() => void onPreparePublish()}>
            {publishBusy ? "블로그 발행 처리 중" : "블로그 등록 준비"}
          </button>
          <button className="button primary" disabled={publishBusy} type="button" onClick={() => void onPublishNow()}>
            {publishBusy ? "즉시 게시 처리 중" : "즉시 업데이트"}
          </button>
          <button className="button ghost" disabled={copyBusy || !exportPreview.bundle} type="button" onClick={() => void onCopyExportPreview?.()}>
            {copyBusy ? "복사 중" : "현재 결과 복사"}
          </button>
          <button
            className="button ghost"
            disabled={exportBusy || !exportPreview.bundle || exportPreview.activeView === "json"}
            type="button"
            onClick={() => void onDownloadExportContent?.()}
          >
            본문 파일 다운로드
          </button>
          <button
            className="button ghost"
            disabled={
              exportBusy ||
              !exportPreview.bundle ||
              exportPreview.activeView === "json" ||
              !activeExportChannel?.hashtagsFilename
            }
            type="button"
            onClick={() => void onDownloadExportHashtags?.()}
          >
            해시태그 파일 다운로드
          </button>
          {copyStatus ? <p className="fine-print">{copyStatus}</p> : null}
        </div>
        <div className="export-preview-card">
          <div className="export-preview-header">
            <div>
              <strong>내보내기 미리보기</strong>
              <p className="fine-print">
                채널별 결과를 바로 복사해 사용할 수 있고, 필요하면 전체 JSON 구조도 확인할 수 있습니다.
              </p>
            </div>
            {exportPreview.bundle ? (
              <div className="export-preview-tabs">
                <button
                  className={`content-tab ${exportPreview.activeView === "blog" ? "active" : ""}`}
                  type="button"
                  onClick={() => onExportPreviewViewChange("blog")}
                >
                  블로그
                </button>
                <button
                  className={`content-tab ${exportPreview.activeView === "instagram" ? "active" : ""}`}
                  type="button"
                  onClick={() => onExportPreviewViewChange("instagram")}
                >
                  인스타
                </button>
                <button
                  className={`content-tab ${exportPreview.activeView === "facebook" ? "active" : ""}`}
                  type="button"
                  onClick={() => onExportPreviewViewChange("facebook")}
                >
                  페이스북
                </button>
                <button
                  className={`content-tab ${exportPreview.activeView === "json" ? "active" : ""}`}
                  type="button"
                  onClick={() => onExportPreviewViewChange("json")}
                >
                  JSON
                </button>
              </div>
            ) : null}
          </div>

          {exportPreview.bundle ? (
            <>
              <div className="export-preview-meta">
                <span className="fine-print">
                  생성 시각 {new Date(exportPreview.bundle.generatedAt).toLocaleString("ko-KR")}
                </span>
                {exportPreview.activeView === "json" ? (
                  <span className="fine-print">{exportPreview.bundle.jsonFilename}</span>
                ) : (
                  <>
                    <span className="fine-print">{activeExportChannel?.filename || "선택된 파일 없음"}</span>
                    {activeExportChannel?.hashtagsFilename ? <span className="fine-print">{activeExportChannel.hashtagsFilename}</span> : null}
                  </>
                )}
              </div>
              <div className="export-preview-body">
                {exportPreview.activeView === "json"
                  ? JSON.stringify(exportPreview.bundle, null, 2)
                  : activeExportChannel
                    ? activeExportChannel.hashtagsFilename
                      ? [activeExportChannel.content, "", "해시태그 파일", activeExportChannel.hashtagsFilename, activeExportChannel.hashtags]
                          .filter(Boolean)
                          .join("\n")
                      : activeExportChannel.content
                    : "선택된 내보내기 초안이 없습니다."}
              </div>
            </>
          ) : (
            <EmptyStatePanel
              title="아직 불러온 내보내기 결과가 없습니다."
              description="위 버튼에서 채널 결과 보기를 먼저 누르면 복사 가능한 최종 콘텐츠가 이 영역에 표시됩니다."
            />
          )}
        </div>
        <div className="export-preview-card">
          <div className="export-preview-header">
            <div>
              <strong>블로그 등록 패키지</strong>
              <p className="fine-print">직접 블로그에 붙여넣을 수 있는 제목, 요약, 대표 이미지, HTML 본문을 확인합니다.</p>
            </div>
          </div>

          {publishPackage ? (
            <>
              <div className="editor-grid">
                <InputField
                  id="blog-publish-title"
                  label="게시 제목"
                  value={publishDraft.title}
                  onChange={(value) => onPublishDraftChange("title", value)}
                  placeholder="블로그 게시 제목"
                />
                <InputField
                  id="blog-publish-slug"
                  label="게시 slug"
                  value={publishDraft.slug}
                  onChange={(value) => onPublishDraftChange("slug", value)}
                  placeholder="예: website-to-content-pipeline"
                />
                <InputField
                  id="blog-publish-summary"
                  label="게시 excerpt"
                  value={publishDraft.summary}
                  onChange={(value) => onPublishDraftChange("summary", value)}
                  placeholder="게시 요약"
                  multiline
                  rows={4}
                />
                <InputField
                  id="blog-publish-html"
                  label="게시 HTML"
                  value={publishDraft.bodyHtml}
                  onChange={(value) => onPublishDraftChange("bodyHtml", value)}
                  placeholder="<article>...</article>"
                  multiline
                  rows={12}
                />
              </div>
              {publishPackage.htmlWarnings.length ? (
                <div className="review-list">
                  {publishPackage.htmlWarnings.map((warning) => (
                    <div className="review-item" key={warning}>
                      <strong>HTML 정리 안내</strong>
                      <p className="fine-print">{warning}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="review-list">
                <div className="review-item">
                  <strong>{publishDraft.title || publishPackage.title}</strong>
                  <p className="fine-print">슬러그 {publishDraft.slug || publishPackage.slug}</p>
                  <p className="fine-print">{publishDraft.summary || publishPackage.summary}</p>
                  {publishPackage.coverImageUrl ? <p className="fine-print">대표 이미지 {publishPackage.coverImageUrl}</p> : null}
                </div>
                {wordpressResult ? (
                  <div className="review-item">
                    <strong>Blogger 게시 완료</strong>
                    <p className="fine-print">Post ID {wordpressResult.postId} · 상태 {wordpressResult.status}</p>
                    {wordpressResult.labels?.length ? <p className="fine-print">라벨 {wordpressResult.labels.join(", ")}</p> : null}
                    <p className="fine-print">{wordpressResult.link}</p>
                  </div>
                ) : null}
              </div>
              <div className="button-row">
                <button className="button ghost" disabled={copyBusy} type="button" onClick={() => void onCopyBlogPublishHtml?.()}>
                  {copyBusy ? "복사 중" : "블로그 HTML 복사"}
                </button>
              </div>
              <div className="export-preview-body">{publishDraft.bodyHtml || publishPackage.bodyHtml}</div>
            </>
          ) : (
            <EmptyStatePanel
              title="블로그 등록 패키지가 아직 없습니다."
              description="매체 등록 준비 버튼을 누르면 블로그용 제목, 요약, 이미지, HTML 본문 패키지가 생성됩니다."
            />
          )}
        </div>
        <div className="review-list">
          {history.length > 0 ? (
            history.slice(0, 6).map((item) => (
              <div className="review-item" key={item.id}>
                <strong>{item.title}</strong>
                <p className="fine-print">{item.description}</p>
                <p className="fine-print">{new Date(item.timestamp).toLocaleString("ko-KR")}</p>
              </div>
            ))
          ) : (
            <EmptyStatePanel
              title="아직 기록된 작업 이력이 없습니다."
              description="저장, 생성, 발행 준비 작업이 발생하면 최근 이력이 운영 패널에 쌓입니다."
            />
          )}
        </div>
      </div>
    </SectionCard>
  );
}
