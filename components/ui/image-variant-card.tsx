import type { CSSProperties } from "react";

import { StatusPill } from "@/components/ui/status-pill";
import type { ImageStudioVariant } from "@/features/dashboard/types";

type ImageVariantCardProps = {
  active?: boolean;
  busy?: boolean;
  variant: ImageStudioVariant;
  onSelect: (variantId: string) => void;
  onApply: (variantId: string) => void;
};

export function ImageVariantCard({
  active = false,
  busy = false,
  variant,
  onSelect,
  onApply,
}: ImageVariantCardProps) {
  return (
    <article className={`image-variant-card ${active ? "active" : ""}`}>
      <button
        className="image-variant-preview"
        style={{ "--image-accent": variant.accent } as CSSProperties}
        type="button"
        disabled={busy}
        onClick={() => onSelect(variant.id)}
      >
        {variant.url ? <img alt={variant.label} className="image-variant-preview-image" src={variant.url} /> : null}
        <span className="image-variant-preview-label">{variant.label}</span>
        <span className="image-variant-preview-copy">{variant.prompt}</span>
      </button>
      <div className="image-variant-meta">
        <div>
          <strong>{variant.label}</strong>
          <p className="fine-print">{variant.prompt}</p>
        </div>
        {active ? <StatusPill active>선택됨</StatusPill> : <StatusPill>미선택</StatusPill>}
      </div>
      <div className="button-row">
        <button className="button ghost" disabled={busy} type="button" onClick={() => onSelect(variant.id)}>
          {active ? "선택 유지" : "선택"}
        </button>
        <button className="button primary" disabled={busy} type="button" onClick={() => onApply(variant.id)}>
          {busy ? "적용 중" : "이 시안 적용"}
        </button>
      </div>
    </article>
  );
}
