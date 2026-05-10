"use client";

import { SectionCard } from "@/components/ui/section-card";
import { SectionLockOverlay } from "../components/section-lock-overlay";
import { VariantComparisonCard } from "../components/variant-comparison";
import type { VariantGroup } from "../types";

type Props = {
  locked: boolean;
  topic: string;
  variantGroup: VariantGroup | null;
  generateBusy: boolean;
  adoptBusy: string | null;
  onGenerateVariants: (count: number) => void;
  onAdoptVariant: (id: string) => void;
};

export function AbTestingCard(props: Props) {
  const {
    locked, topic, variantGroup,
    generateBusy, adoptBusy,
    onGenerateVariants, onAdoptVariant,
  } = props;

  const hasVariants = (variantGroup?.variants?.length ?? 0) > 0;
  const adoptedVariant = variantGroup?.variants?.find((v) => v.adopted);

  return (
    <div className="pipeline-section">
      <SectionCard title="A/B 버전 비교" description="같은 토픽, 다른 앵글로 2~3개 버전을 비교합니다">
        {locked && <SectionLockOverlay message="콘텐츠를 먼저 생성해 주세요." />}

        <div className="wizard-stage">
          {/* Generate buttons */}
          <div className="button-row">
            <button
              className="button primary"
              disabled={generateBusy || !topic}
              onClick={() => onGenerateVariants(2)}
            >
              {generateBusy ? "생성 중…" : "A/B 2개 생성"}
            </button>
            <button
              className="button ghost"
              disabled={generateBusy || !topic}
              onClick={() => onGenerateVariants(3)}
            >
              3개 생성
            </button>
          </div>

          {/* Variant comparison grid */}
          {hasVariants && (
            <div className="variant-comparison-grid">
              {variantGroup!.variants.map((variant) => (
                <VariantComparisonCard
                  key={variant.id}
                  variant={variant}
                  onAdopt={onAdoptVariant}
                  adoptBusy={adoptBusy === variant.id}
                />
              ))}
            </div>
          )}

          {/* Adopted indicator */}
          {adoptedVariant && (
            <div className="step-focus-banner">
              <span className="eyebrow">채택된 버전</span>
              <p className="fine-print" style={{ marginTop: 4 }}>
                <strong>{adoptedVariant.variantLabel}</strong> — {adoptedVariant.blogTitle || adoptedVariant.topic}
              </p>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
