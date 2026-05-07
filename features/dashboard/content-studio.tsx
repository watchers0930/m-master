import { EmptyStatePanel } from "@/components/ui/empty-state-panel";
import { ImageVariantCard } from "@/components/ui/image-variant-card";
import { InputField } from "@/components/ui/input-field";
import { PublishPanel } from "@/features/dashboard/publish-panel";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  BlogPublishDraft,
  BlogPublishPackage,
  ChannelKey,
  ExportPreviewState,
  ImageStudioState,
  ProjectActivityItem,
  ProjectDetail,
  ReviewFinding,
  StudioDetail,
  WordPressPublishConfig,
  WordPressPublishResult,
} from "@/features/dashboard/types";

function compactText(value?: string | null, maxLength = 120) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

type ContentStudioProps = {
  detail?: ProjectDetail | null;
  studio?: StudioDetail | null;
  imageStudio: ImageStudioState;
  history: ProjectActivityItem[];
  imageBusy?: boolean;
  exportBusy?: boolean;
  publishBusy?: boolean;
  settingsBusy?: boolean;
  copyBusy?: boolean;
  copyStatus?: string | null;
  publishPackage?: BlogPublishPackage | null;
  publishDraft: BlogPublishDraft;
  wordpressConfig: WordPressPublishConfig;
  wordpressResult?: WordPressPublishResult | null;
  exportPreview: ExportPreviewState;
  activeChannel: ChannelKey;
  selectedTopicId?: string | null;
  loading?: boolean;
  onChannelChange: (channel: ChannelKey) => void;
  onTopicSelect: (topicId: string) => void;
  onAssetChange: (channel: ChannelKey, field: "title" | "body" | "cta" | "hashtags", value: string) => void;
  onImagePromptChange: (value: string) => void;
  onGenerateImages: () => void;
  onSelectImageVariant: (variantId: string) => void;
  onApplyImageVariant: (variantId: string) => void;
  onSaveContent: () => Promise<void>;
  onGenerateContent: () => Promise<void>;
  onExportChannel: (channel: ChannelKey) => Promise<void>;
  onExportAll: () => Promise<void>;
  onExportPreviewViewChange: (view: ChannelKey | "json") => void;
  onPreparePublish: () => Promise<void>;
  onSaveWordPressDefaults: () => Promise<void>;
  onCopyExportPreview?: () => Promise<void>;
  onDownloadExportContent?: () => Promise<void>;
  onDownloadExportHashtags?: () => Promise<void>;
  onCopyBlogPublishHtml?: () => Promise<void>;
  onPublishDraftChange: (field: keyof BlogPublishDraft, value: string) => void;
  onWordPressConfigChange: (field: keyof WordPressPublishConfig, value: string) => void;
  showTopics?: boolean;
  showContent?: boolean;
  showImages?: boolean;
  showReview?: boolean;
  showOps?: boolean;
  onContinueWithTopic?: () => Promise<void>;
  onJumpToReviewTarget?: (finding: ReviewFinding) => void;
};

const channelLabels = {
  blog: "블로그",
  instagram: "인스타그램",
  facebook: "페이스북",
} as const;

const generationProviderMeta = {
  openai: {
    label: "GPT 초안",
    detail: "OpenAI로 생성된 초안입니다.",
  },
  fallback: {
    label: "기본 템플릿",
    detail: "외부 생성 실패 또는 미사용 시 규칙 기반 초안입니다.",
  },
} as const;

export function ContentStudio({
  detail,
  studio,
  imageStudio,
  history,
  imageBusy = false,
  exportBusy = false,
  publishBusy = false,
  settingsBusy = false,
  copyBusy = false,
  copyStatus = null,
  publishPackage = null,
  publishDraft,
  wordpressConfig,
  wordpressResult = null,
  exportPreview,
  activeChannel,
  selectedTopicId,
  loading = false,
  onChannelChange,
  onTopicSelect,
  onAssetChange,
  onImagePromptChange,
  onGenerateImages,
  onSelectImageVariant,
  onApplyImageVariant,
  onSaveContent,
  onGenerateContent,
  onExportChannel,
  onExportAll,
  onExportPreviewViewChange,
  onPreparePublish,
  onSaveWordPressDefaults,
  onCopyExportPreview,
  onDownloadExportContent,
  onDownloadExportHashtags,
  onCopyBlogPublishHtml,
  onPublishDraftChange,
  onWordPressConfigChange,
  showTopics = true,
  showContent = true,
  showImages = true,
  showReview = true,
  showOps = true,
  onContinueWithTopic,
  onJumpToReviewTarget,
}: ContentStudioProps) {
  const activeAsset = studio?.draft.assets.find((asset) => asset.channel === activeChannel);
  const providerMeta = studio ? generationProviderMeta[studio.draft.generationProvider] : null;
  const hasImageVariants = imageStudio.variants.length > 0;
  const activeExportChannel =
    exportPreview.activeView === "json"
      ? null
      : exportPreview.bundle?.channels.find((item) => item.channel === exportPreview.activeView) ?? null;

  return (
    <div className="stack">
      {showTopics ? (
        <SectionCard
          title="작성 테마 선택"
          description="이번에 만들 콘텐츠의 기준 테마를 하나 고릅니다. 선택한 테마를 기준으로 블로그, 인스타그램, 페이스북 초안을 생성합니다."
          badge="Step 3"
        >
          {detail?.topics.length ? (
            <div className="stack">
              <div className="step-focus-card">
                <strong>지금 할 일</strong>
                <p className="fine-print">
                  테마 하나를 고른 뒤 바로 초안을 생성하세요. 생성되면 채널별 문안이 한 번에 준비됩니다.
                </p>
                <div className="button-row">
                  <StatusPill active>{detail.topics.find((topic) => topic.id === selectedTopicId)?.title || "주제 선택 필요"}</StatusPill>
                  <button
                    className="button primary"
                    disabled={loading || !selectedTopicId}
                    type="button"
                    onClick={() => void onContinueWithTopic?.()}
                  >
                    {loading ? "초안 생성 중" : "이 테마로 콘텐츠 만들기"}
                  </button>
                </div>
              </div>

              <div className="topic-chip-wrap">
                {detail.topics.map((topic) => (
                  <button
                    className={`topic-chip selectable ${selectedTopicId === topic.id ? "active" : ""}`}
                    key={topic.id}
                    type="button"
                    onClick={() => onTopicSelect(topic.id)}
                  >
                    <strong>{topic.title}</strong>
                    <span className="fine-print">
                      {topic.intentType || "general"} · {topic.score?.toFixed(1) ?? "-"}
                    </span>
                    <span className="fine-print">{compactText(topic.rationale, 120) || "추천 이유 없음"}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyStatePanel title="추천 주제가 아직 없습니다." description="프로젝트 분석이 끝나면 우선순위 주제가 여기에 쌓입니다." />
          )}
        </SectionCard>
      ) : null}

      {showContent ? (
        <SectionCard
          title="채널별 콘텐츠 작성"
          description="블로그, 인스타그램, 페이스북 초안을 채널별로 다듬습니다. 하나씩 수정해도 되고, 초안 다시 만들기로 전체 채널 문안을 다시 생성할 수도 있습니다."
          badge="Step 4"
        >
          {studio ? (
            <>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <strong style={{ display: "block", fontSize: 18, marginBottom: 6 }}>
                    {studio.draft.topic || "선택된 주제가 없습니다."}
                  </strong>
                  <span className="fine-print">{studio.draft.objective}</span>
                  {providerMeta ? <p className="fine-print" style={{ marginTop: 6 }}>{providerMeta.detail}</p> : null}
                </div>
                <div className="button-cluster">
                  {providerMeta ? <StatusPill active={studio.draft.generationProvider === "openai"}>{providerMeta.label}</StatusPill> : null}
                  <StatusPill active>{studio.project.status}</StatusPill>
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onGenerateContent()}>
                    {loading ? "초안 생성 중" : "채널 초안 다시 만들기"}
                  </button>
                  <button className="button primary" disabled={loading} type="button" onClick={() => void onSaveContent()}>
                    {loading ? "저장 중" : "채널 내용 저장"}
                  </button>
                </div>
              </div>
              <div className="step-focus-card" style={{ marginBottom: 16 }}>
                <strong>지금 할 일</strong>
                <p className="fine-print">
                  위 채널 탭에서 하나를 고르고 제목, 본문, CTA를 다듬으세요. 저장은 현재 보이는 채널 기준으로 진행됩니다.
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
              <div className="content-editor-grid">
                <InputField
                  id={`studio-title-${activeChannel}`}
                  label={`${channelLabels[activeChannel]} 제목`}
                  value={activeAsset?.title || ""}
                  onChange={(value) => onAssetChange(activeChannel, "title", value)}
                  placeholder="채널 제목을 직접 다듬으세요."
                />
                <InputField
                  id={`studio-body-${activeChannel}`}
                  label={`${channelLabels[activeChannel]} 본문`}
                  value={activeAsset?.body || ""}
                  onChange={(value) => onAssetChange(activeChannel, "body", value)}
                  placeholder="본문 초안을 직접 편집하세요."
                  multiline
                  rows={12}
                />
                <InputField
                  id={`studio-cta-${activeChannel}`}
                  label={`${channelLabels[activeChannel]} CTA`}
                  value={activeAsset?.cta || ""}
                  onChange={(value) => onAssetChange(activeChannel, "cta", value)}
                  placeholder="이 채널에서 쓸 CTA를 입력하세요."
                  multiline
                  rows={4}
                />
                <InputField
                  id={`studio-hashtags-${activeChannel}`}
                  label={`${channelLabels[activeChannel]} 해시태그`}
                  value={activeAsset?.hashtags || ""}
                  onChange={(value) => onAssetChange(activeChannel, "hashtags", value)}
                  placeholder="#토픽, #브랜드명 형태로 입력하고 더 추가할 수 있습니다."
                  multiline
                  rows={3}
                />
                <p className="fine-print" style={{ marginTop: -6 }}>
                  자동 생성된 태그를 시작점으로 쓰고, 필요한 해시태그를 직접 추가해 확장할 수 있습니다.
                </p>
                <div className="content-editor preview">
                  <strong style={{ display: "block", fontSize: 16, marginBottom: 10 }}>
                    {activeAsset?.title || "채널 초안 없음"}
                  </strong>
                  {activeAsset?.body || "초안이 아직 준비되지 않았습니다."}
                  {activeAsset?.cta ? `\n\nCTA\n${activeAsset.cta}` : ""}
                  {activeAsset?.hashtags ? `\n\n해시태그\n${activeAsset.hashtags}` : ""}
                </div>
              </div>
            </>
          ) : (
            <EmptyStatePanel
              title="콘텐츠 스튜디오 초안이 없습니다."
              description="프로젝트를 선택하면 채널별 초안과 편집 패널이 이 영역에 표시됩니다."
            />
          )}
        </SectionCard>
      ) : null}

      {showImages ? (
        <SectionCard
          title="채널용 이미지 생성"
          description="선택한 채널에 맞는 이미지 프롬프트를 입력하고 시안을 생성합니다. 문안에 맞는 대표 이미지를 고른 뒤 최종안으로 적용하면 됩니다."
          badge="Step 5"
          tone="soft"
        >
          <div className="image-studio-stack">
            <div className="image-studio-toolbar">
              <InputField
                id={`image-prompt-${activeChannel}`}
                label={`${channelLabels[activeChannel]} 이미지 프롬프트`}
                value={imageStudio.prompt}
                onChange={onImagePromptChange}
                placeholder={`${channelLabels[activeChannel]}용 이미지 콘셉트, 구도, 분위기를 입력하세요.`}
                multiline
                rows={4}
                hint="시안을 생성한 뒤 대표 이미지를 적용하면 최종 검수 단계로 이어집니다."
              />
              <div className="image-studio-actions">
                <StatusPill active>{channelLabels[activeChannel]}</StatusPill>
                <button className="button primary" disabled={imageBusy} type="button" onClick={onGenerateImages}>
                  {imageBusy ? "시안 생성 중" : "이미지 시안 생성"}
                </button>
              </div>
            </div>

            {hasImageVariants ? (
              <div className="image-variant-grid">
                {imageStudio.variants.map((variant) => (
                  <ImageVariantCard
                    key={variant.id}
                    active={imageStudio.selectedVariantId === variant.id}
                    variant={variant}
                    onSelect={onSelectImageVariant}
                    onApply={onApplyImageVariant}
                    busy={imageBusy}
                  />
                ))}
              </div>
            ) : (
              <EmptyStatePanel
                title="생성된 이미지 시안이 없습니다."
                description="프롬프트를 입력한 뒤 생성 버튼을 누르면 채널별 기본 시안이 여기에 표시됩니다."
              />
            )}
          </div>
        </SectionCard>
      ) : null}

      {showReview ? (
        <SectionCard
          title="최종 검수"
          description="브랜드 일치도, 채널 적합도, CTA 명확성을 확인합니다. 수정이 필요하면 해당 채널로 바로 돌아갈 수 있습니다."
          badge="Step 6"
        >
          {studio?.brandProfile ? (
            <>
              <div className="kpi-grid">
                <div className="kpi-item">
                  <strong>{studio.review.scores.brandAlignment}</strong>
                  <span className="fine-print">브랜드 일치도</span>
                </div>
                <div className="kpi-item">
                  <strong>{studio.review.scores.formatFit}</strong>
                  <span className="fine-print">채널 적합도</span>
                </div>
                <div className="kpi-item">
                  <strong>{studio.review.scores.ctaClarity}</strong>
                  <span className="fine-print">CTA 명확성</span>
                </div>
              </div>
              <div className="review-list" style={{ marginTop: 16 }}>
                <div className="review-item">
                  <strong>리스크 점수</strong>
                  <p className="fine-print">{studio.review.scores.riskControl}</p>
                </div>
                {studio.review.findings.length > 0 ? (
                  studio.review.findings.map((finding, index) => (
                    <div className="review-item" key={`${finding.channel}-${finding.type}-${index}`}>
                      <strong>{`${finding.channel} · ${finding.type}`}</strong>
                      <p className="fine-print">{finding.message}</p>
                      <button className="button ghost" type="button" onClick={() => onJumpToReviewTarget?.(finding)}>
                        이 항목 수정하러 가기
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="review-item">
                    <strong>검수 결과</strong>
                    <p className="fine-print">현재 초안은 내보내기 전 기본 검수 기준을 통과했습니다.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <EmptyStatePanel
              title="검수 패널 데이터가 없습니다."
              description="프로젝트 생성 후 브랜드/형식 검수 결과가 자동으로 이 영역에 채워집니다."
            />
          )}
        </SectionCard>
      ) : null}

      {showOps ? (
        <PublishPanel
          activeChannel={activeChannel}
          copyBusy={copyBusy}
          copyStatus={copyStatus}
          exportBusy={exportBusy}
          publishBusy={publishBusy}
          settingsBusy={settingsBusy}
          exportPreview={exportPreview}
          history={history}
          publishPackage={publishPackage}
          publishDraft={publishDraft}
          wordpressConfig={wordpressConfig}
          wordpressResult={wordpressResult}
          onChannelChange={onChannelChange}
          onExportChannel={onExportChannel}
          onExportAll={onExportAll}
          onExportPreviewViewChange={onExportPreviewViewChange}
          onPreparePublish={onPreparePublish}
          onSaveWordPressDefaults={onSaveWordPressDefaults}
          onCopyExportPreview={onCopyExportPreview}
          onDownloadExportContent={onDownloadExportContent}
          onDownloadExportHashtags={onDownloadExportHashtags}
          onCopyBlogPublishHtml={onCopyBlogPublishHtml}
          onPublishDraftChange={onPublishDraftChange}
          onWordPressConfigChange={onWordPressConfigChange}
        />
      ) : null}
    </div>
  );
}
