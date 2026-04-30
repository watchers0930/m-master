import { EmptyStatePanel } from "@/components/ui/empty-state-panel";
import { ImageVariantCard } from "@/components/ui/image-variant-card";
import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  ChannelKey,
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
  onPreparePublish: () => Promise<void>;
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
  onPreparePublish,
}: ContentStudioProps) {
  const activeAsset = studio?.draft.assets.find((asset) => asset.channel === activeChannel);
  const hasImageVariants = imageStudio.variants.length > 0;

  return (
    <div className="stack">
      <SectionCard
        title="추천 주제"
        description="검색형, 브랜딩형, 전환형 토픽을 우선순위로 제시하고 콘텐츠 스튜디오의 기준 주제를 고정합니다."
        badge="Step 3"
      >
        {detail?.topics.length ? (
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
        ) : (
          <EmptyStatePanel title="추천 주제가 아직 없습니다." description="프로젝트 분석이 끝나면 우선순위 주제가 여기에 쌓입니다." />
        )}
      </SectionCard>

      <SectionCard
        title="콘텐츠 스튜디오"
        description="블로그 원문과 인스타그램·페이스북 파생 초안을 한 화면에서 비교하고 다듬는 공간입니다."
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
                <button className="button" disabled={loading} type="button" onClick={() => void onSaveContent()}>
                  {loading ? "저장 중" : "초안 저장"}
                </button>
                <button className="button ghost" disabled={loading} type="button" onClick={() => void onGenerateContent()}>
                  {loading ? "초안 생성 중" : "선택 주제로 초안 생성"}
                </button>
              </div>
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

      <SectionCard
        title="이미지 스튜디오"
        description="선택 채널에 맞는 이미지 프롬프트를 입력하고 3개의 변형 시안을 비교해 대표 시안을 고릅니다."
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
                {imageBusy ? "시안 생성 중" : "변형 3종 생성"}
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
              description="프롬프트를 입력한 뒤 생성 버튼을 누르면 채널별 썸네일 3개가 여기에 표시됩니다."
            />
          )}
        </div>
      </SectionCard>

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

      <SectionCard
        title="운영 패널"
        description="채널별 초안을 파일로 내보내고, 현재 저장본을 발행 준비 상태로 전환합니다."
        badge="Ops"
      >
        <div className="ops-grid">
          <div className="ops-actions">
            <button className="button" disabled={exportBusy} type="button" onClick={() => void onExportChannel("blog")}>
              블로그 내보내기
            </button>
            <button className="button" disabled={exportBusy} type="button" onClick={() => void onExportChannel("instagram")}>
              인스타 내보내기
            </button>
            <button className="button" disabled={exportBusy} type="button" onClick={() => void onExportChannel("facebook")}>
              페이스북 내보내기
            </button>
            <button className="button ghost" disabled={exportBusy} type="button" onClick={() => void onExportAll()}>
              전체 JSON 내보내기
            </button>
            <button className="button primary" disabled={publishBusy} type="button" onClick={() => void onPreparePublish()}>
              {publishBusy ? "발행 준비 중" : "발행 준비"}
            </button>
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
    </div>
  );
}
