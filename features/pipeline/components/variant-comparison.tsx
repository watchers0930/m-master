"use client";

import type { VariantSummary } from "../types";

const ANGLE_LABELS: Record<string, string> = {
  "실무 사례 중심": "실무 사례",
  "데이터·수치 중심": "데이터 중심",
  "질문-답변 구조": "Q&A 구조",
};

function normalizeLabel(label: string) {
  return ANGLE_LABELS[label] || label;
}

function scoreAverage(scores?: VariantSummary["reviewScores"]) {
  if (!scores) return 0;
  return Math.round(
    (scores.brandAlignment + scores.formatFit + scores.ctaClarity + scores.riskControl) / 4,
  );
}

export function VariantComparisonCard({
  variant,
  onAdopt,
  adoptBusy,
}: {
  variant: VariantSummary;
  onAdopt: (id: string) => void;
  adoptBusy: boolean;
}) {
  const avg = scoreAverage(variant.reviewScores);

  return (
    <div className={`variant-card ${variant.adopted ? "variant-adopted" : ""}`}>
      <div className="variant-card-header">
        <span className="eyebrow">{normalizeLabel(variant.variantLabel)}</span>
        {variant.adopted && <span className="status-pill active">채택됨</span>}
      </div>

      <h4 className="variant-card-title">{variant.blogTitle || variant.topic}</h4>

      <div className="variant-card-stats">
        {variant.blogBodyLength != null && (
          <span className="fine-print">{variant.blogBodyLength.toLocaleString()}자</span>
        )}
        {variant.seoScore != null && (
          <span className="fine-print">SEO {variant.seoScore}점</span>
        )}
        {variant.reviewScores && (
          <span className="fine-print">리뷰 {avg}점</span>
        )}
      </div>

      {variant.reviewScores && (
        <div className="variant-scores-grid">
          <div className="variant-score-item">
            <span className="fine-print">브랜드</span>
            <strong>{variant.reviewScores.brandAlignment}</strong>
          </div>
          <div className="variant-score-item">
            <span className="fine-print">포맷</span>
            <strong>{variant.reviewScores.formatFit}</strong>
          </div>
          <div className="variant-score-item">
            <span className="fine-print">CTA</span>
            <strong>{variant.reviewScores.ctaClarity}</strong>
          </div>
          <div className="variant-score-item">
            <span className="fine-print">리스크</span>
            <strong>{variant.reviewScores.riskControl}</strong>
          </div>
        </div>
      )}

      {!variant.adopted && (
        <button
          className="button primary"
          disabled={adoptBusy}
          onClick={() => onAdopt(variant.id)}
        >
          {adoptBusy ? "채택 중…" : "이 버전 채택"}
        </button>
      )}
    </div>
  );
}
