"use client";

import type { StudioAsset, ChannelKey } from "../types";

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  blog: "블로그",
  instagram: "인스타그램",
  facebook: "페이스북",
};

export function DerivedChannelPanel({
  assets,
}: {
  assets: StudioAsset[];
}) {
  const derivedAssets = assets.filter((a) => a.channel !== "blog");

  if (derivedAssets.length === 0) {
    return (
      <div className="derived-panel-empty">
        <p className="fine-print">블로그 콘텐츠를 먼저 생성하면 파생 채널이 자동으로 만들어집니다.</p>
      </div>
    );
  }

  return (
    <div className="derived-panel">
      {derivedAssets.map((asset) => (
        <div key={asset.channel} className="derived-card">
          <div className="derived-card-header">
            <span className="eyebrow">{CHANNEL_LABELS[asset.channel]}</span>
            <span className="status-pill">자동 파생</span>
          </div>
          <h4 className="derived-card-title">{asset.title}</h4>
          <div className="derived-card-body">
            <p className="fine-print" style={{ whiteSpace: "pre-wrap" }}>
              {asset.body.length > 300 ? `${asset.body.slice(0, 300)}…` : asset.body}
            </p>
          </div>
          {asset.hashtags && (
            <p className="derived-card-tags fine-print">{asset.hashtags}</p>
          )}
        </div>
      ))}
    </div>
  );
}
