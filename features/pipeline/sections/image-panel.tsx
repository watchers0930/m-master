"use client";

import type { ChannelKey, ImageStudioState } from "../types";

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  blog: "블로그 (1200×628)",
  instagram: "인스타 (1080×1080)",
  facebook: "페이스북 (1200×630)",
};

type Props = {
  image: {
    projectId: string | undefined;
    activeChannel: ChannelKey;
    onChannelChange: (ch: ChannelKey) => void;
    currentStudio: ImageStudioState | null;
    generateBusy: boolean;
    selectBusy: boolean;
    onGenerateImages: (projectId: string, channel: ChannelKey) => void;
    onSelectImage: (projectId: string, channel: ChannelKey, imageAssetId: string) => void;
    hasContent: boolean;
  };
};

export function ImagePanel(props: Props) {
  const {
    projectId,
    activeChannel, onChannelChange,
    currentStudio,
    generateBusy, selectBusy,
    onGenerateImages, onSelectImage,
    hasContent,
  } = props.image;

  const variants = currentStudio?.variants ?? [];

  if (!hasContent) {
    return (
      <div className="image-panel">
        <div className="ip-empty">
          <span className="eyebrow">이미지 미리보기</span>
          <p className="fine-print">콘텐츠를 생성하면 채널별 이미지를 만들 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="image-panel">
      <div className="ip-header">
        <span className="eyebrow">이미지</span>
      </div>

      {/* Channel tabs */}
      <div className="ip-tabs">
        {(["blog", "instagram", "facebook"] as ChannelKey[]).map((ch) => (
          <button
            key={ch}
            className={`content-tab ${activeChannel === ch ? "active" : ""}`}
            onClick={() => onChannelChange(ch)}
          >
            {ch === "blog" ? "블로그" : ch === "instagram" ? "인스타" : "페북"}
          </button>
        ))}
      </div>

      <p className="fine-print">{CHANNEL_LABELS[activeChannel]}</p>

      {/* Generate button */}
      <button
        className="button primary ip-btn-full"
        disabled={generateBusy || !projectId}
        onClick={() => projectId && onGenerateImages(projectId, activeChannel)}
      >
        {generateBusy ? "생성 중…" : "이미지 생성"}
      </button>

      {/* Variants */}
      {variants.length > 0 && (
        <div className="ip-variant-list">
          {variants.map((v) => (
            <div key={v.id} className={`ip-variant-card ${v.selected ? "ip-variant-selected" : ""}`}>
              <div className="ip-variant-preview">
                {v.url ? (
                  <img src={v.url} alt={v.role} className="ip-variant-img" />
                ) : (
                  <div className="ip-variant-placeholder">
                    <span className="fine-print">미리보기 없음</span>
                  </div>
                )}
              </div>
              <div className="ip-variant-footer">
                <span className="fine-print">{v.role}</span>
                {v.selected ? (
                  <span className="status-pill active">선택됨</span>
                ) : (
                  <button
                    className="button ghost"
                    disabled={selectBusy}
                    onClick={() => projectId && onSelectImage(projectId, activeChannel, v.id)}
                  >
                    선택
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {variants.length === 0 && (
        <div className="ip-no-variants">
          <p className="fine-print">이미지를 생성하면 3개 변형이 표시됩니다.</p>
        </div>
      )}
    </div>
  );
}
