import { EmptyStatePanel } from "@/components/ui/empty-state-panel";
import { ImageVariantCard } from "@/components/ui/image-variant-card";
import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  ChannelKey,
  ExportPreviewState,
  ImageStudioState,
  ProjectActivityItem,
  ProjectDetail,
  StudioDetail,
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
  exportPreview: ExportPreviewState;
  activeChannel: ChannelKey;
  selectedTopicId?: string | null;
  loading?: boolean;
  onChannelChange: (channel: ChannelKey) => void;
  onTopicSelect: (topicId: string) => void;
  onAssetChange: (channel: ChannelKey, field: "title" | "body" | "cta", value: string) => void;
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
  showTopics?: boolean;
  showContent?: boolean;
  showImages?: boolean;
  showReview?: boolean;
  showOps?: boolean;
  onContinueWithTopic?: () => Promise<void>;
};

const channelLabels = {
  blog: "블로그",
  instagram: "인스타그램",
  facebook: "페이스북",
} as const;

export function ContentStudio({
  detail,
  studio,
  imageStudio,
  history,
  imageBusy = false,
  exportBusy = false,
  publishBusy = false,
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
  showTopics = true,
  showContent = true,
  showImages = true,
  showReview = true,
  showOps = true,
  onContinueWithTopic,
}: ContentStudioProps) {
  const activeAsset = studio?.draft.assets.find((asset) => asset.channel === activeChannel);
  const hasImageVariants = imageStudio.variants.length > 0;
  const activeExportChannel =
    exportPreview.activeView === "json"
      ? null
      : exportPreview.bundle?.channels.find((item) => item.channel === exportPreview.activeView) ?? null;

  return (
    <div className="stack">
      {showTopics ? (
        <SectionCard
          title="추천 주제"
          description="먼저 이번 작업의 기준 주제를 하나만 고르고, 바로 초안 생성을 시작합니다."
          badge="Step 3"
        >
          {detail?.topics.length ? (
            <div className="stack">
              <div className="step-focus-card">
                <strong>지금 할 일</strong>
                <p className="fine-print">
                  추천 주제 중 하나를 고른 뒤 바로 `이 주제로 초안 만들기`만 누르면 됩니다.
                </p>
                <div className="button-row">
                  <StatusPill active>{detail.topics.find((topic) => topic.id === selectedTopicId)?.title || "주제 선택 필요"}</StatusPill>
                  <button
                    className="button primary"
                    disabled={loading || !selectedTopicId}
                    type="button"
                    onClick={() => void onContinueWithTopic?.()}
                  >
                    {loading ? "초안 생성 중" : "이 주제로 초안 만들기"}
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
          title="콘텐츠 스튜디오"
          description="한 번에 하나의 채널만 보고 수정합니다. 필요하면 저장하고 다음 채널로 넘어가면 됩니다."
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
                </div>
                <div className="button-cluster">
                  <StatusPill active>{studio.project.status}</StatusPill>
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onGenerateContent()}>
                    {loading ? "초안 생성 중" : "초안 다시 만들기"}
                  </button>
                  <button className="button primary" disabled={loading} type="button" onClick={() => void onSaveContent()}>
                    {loading ? "저장 중" : "이 채널 내용 저장"}
                  </button>
                </div>
              </div>
              <div className="step-focus-card" style={{ marginBottom: 16 }}>
                <strong>지금 할 일</strong>
                <p className="fine-print">
                  위 채널 탭에서 하나를 고르고 내용만 다듬으세요. 저장은 현재 보이는 초안 기준으로 진행됩니다.
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
                <div className="content-editor preview">
                  <strong style={{ display: "block", fontSize: 16, marginBottom: 10 }}>
                    {activeAsset?.title || "채널 초안 없음"}
                  </strong>
                  {activeAsset?.body || "초안이 아직 준비되지 않았습니다."}
                  {activeAsset?.cta ? `\n\nCTA\n${activeAsset.cta}` : ""}
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
          title="이미지 스튜디오"
          description="선택 채널에 맞는 이미지 프롬프트를 입력하고 저비용 기본 시안을 먼저 생성한 뒤 필요할 때만 추가 확장하는 영역입니다."
          badge="Image"
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
                hint="생성 버튼은 상위 콜백만 호출합니다. 실제 생성 연결은 상위 레이어에서 붙이면 됩니다."
              />
              <div className="image-studio-actions">
                <StatusPill active>{channelLabels[activeChannel]}</StatusPill>
                <button className="button primary" disabled={imageBusy} type="button" onClick={onGenerateImages}>
                  {imageBusy ? "시안 생성 중" : "기본 시안 생성"}
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
          title="검수 패널"
          description="브랜드 일치도, 채널 적합도, 금지 표현 여부를 빠르게 확인하는 MVP 검수 영역입니다."
          badge="Step 5"
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
        <SectionCard
          title="운영 패널"
          description="먼저 채널 하나만 확인한 뒤, 필요하면 전체 JSON을 확인하고 발행 준비로 넘깁니다."
          badge="Ops"
        >
          <div className="ops-grid">
            <div className="ops-actions">
              <div className="ops-action-guide">
                <strong>지금 할 일</strong>
                <p className="fine-print">
                  검수할 채널을 하나 고른 뒤 `현재 채널 미리보기`를 먼저 보세요. 구조 확인이 필요할 때만 `전체 JSON 보기`를 쓰면 됩니다.
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
                {exportBusy ? "미리보기 불러오는 중" : `${channelLabels[activeChannel]} 미리보기`}
              </button>
              <button className="button ghost" disabled={exportBusy} type="button" onClick={() => void onExportAll()}>
                전체 JSON 보기
              </button>
              <button className="button" disabled={publishBusy} type="button" onClick={() => void onPreparePublish()}>
                {publishBusy ? "발행 준비 중" : "발행 준비"}
              </button>
            </div>
            <div className="export-preview-card">
              <div className="export-preview-header">
                <div>
                  <strong>내보내기 미리보기</strong>
                  <p className="fine-print">
                    채널별 Markdown 또는 전체 JSON을 먼저 확인한 뒤 필요한 경우 별도로 저장할 수 있습니다.
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
                    <span className="fine-print">
                      {exportPreview.activeView === "json"
                        ? exportPreview.bundle.jsonFilename
                        : activeExportChannel?.filename || "선택된 파일 없음"}
                    </span>
                  </div>
                  <div className="export-preview-body">
                    {exportPreview.activeView === "json"
                      ? JSON.stringify(exportPreview.bundle, null, 2)
                      : activeExportChannel?.content || "선택된 내보내기 초안이 없습니다."}
                  </div>
                </>
              ) : (
                <EmptyStatePanel
                  title="아직 불러온 내보내기 결과가 없습니다."
                  description="위 버튼 중 `블로그 미리보기`를 먼저 누르거나, 구조를 보고 싶다면 `전체 JSON 보기`를 누르면 이 영역에 바로 표시됩니다."
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
      ) : null}
    </div>
  );
}
