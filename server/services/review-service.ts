type ReviewInput = {
  summary: string;
  cta?: string | null;
  bannedTerms?: string | null;
  assets: Array<{
    channel: string;
    title?: string | null;
    body: string;
    cta?: string | null;
  }>;
};

export type ReviewSummary = {
  scores: {
    brandAlignment: number;
    formatFit: number;
    ctaClarity: number;
    riskControl: number;
  };
  findings: Array<{
    channel: string;
    type: "brand" | "format" | "cta" | "risk";
    severity: "info" | "warning";
    message: string;
  }>;
  status: "ready" | "needs-edit";
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildReviewSummary(input: ReviewInput): ReviewSummary {
  const findings: ReviewSummary["findings"] = [];
  let brandAlignment = 90;
  let formatFit = 92;
  let ctaClarity = 88;
  let riskControl = 94;

  for (const asset of input.assets) {
    if (!asset.body.includes(input.summary.slice(0, 12))) {
      brandAlignment -= 6;
      findings.push({
        channel: asset.channel,
        type: "brand",
        severity: "warning",
        message: "브랜드 핵심 요약 문맥이 본문에 충분히 반영되지 않았습니다.",
      });
    }

    if (asset.channel === "instagram" && asset.body.split("\n").length < 4) {
      formatFit -= 8;
      findings.push({
        channel: asset.channel,
        type: "format",
        severity: "warning",
        message: "인스타그램 카드형 문장 수가 부족합니다.",
      });
    }

    if (asset.channel === "facebook" && asset.body.length < 120) {
      formatFit -= 5;
      findings.push({
        channel: asset.channel,
        type: "format",
        severity: "warning",
        message: "페이스북 링크 포스트 길이가 너무 짧습니다.",
      });
    }

    if (input.cta && !(asset.cta || asset.body).includes(input.cta.slice(0, 8))) {
      ctaClarity -= 7;
      findings.push({
        channel: asset.channel,
        type: "cta",
        severity: "warning",
        message: "승인된 CTA 문맥이 충분히 드러나지 않습니다.",
      });
    }

    const bannedTerms = (input.bannedTerms || "")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);

    if (bannedTerms.some((term) => asset.body.includes(term))) {
      riskControl -= 18;
      findings.push({
        channel: asset.channel,
        type: "risk",
        severity: "warning",
        message: "금지 표현 후보가 포함되어 있습니다.",
      });
    }
  }

  return {
    scores: {
      brandAlignment: clampScore(brandAlignment),
      formatFit: clampScore(formatFit),
      ctaClarity: clampScore(ctaClarity),
      riskControl: clampScore(riskControl),
    },
    findings,
    status: findings.some((item) => item.severity === "warning") ? "needs-edit" : "ready",
  };
}
