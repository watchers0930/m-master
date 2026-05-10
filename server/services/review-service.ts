import type { SeoComplianceResult } from "@/features/pipeline/types";

type ReviewInput = {
  summary: string;
  cta?: string | null;
  bannedTerms?: string | null;
  assets: Array<{
    channel: string;
    title?: string | null;
    body: string;
    cta?: string | null;
    hashtags?: string | null;
  }>;
};

const NAVER_BLOG_GUIDE = {
  minChars: 1000,
  targetCharsMin: 1500,
  targetCharsMax: 2200,
  hardMinImageCues: 2,
  recommendedImageCuesMin: 4,
  recommendedImageCuesMax: 7,
} as const;

const BRAND_KEYWORD_STOPWORDS = new Set([
  "그리고",
  "중심",
  "기준",
  "콘텐츠",
  "서비스",
  "프로젝트",
  "마케팅",
  "블로그",
  "인스타그램",
  "페이스북",
  "사용자",
  "실무",
  "잠재",
  "고객",
  "핵심",
  "vercel",
  "app",
  "html",
]);
const KOREAN_SUFFIXES = ["입니다", "하는", "하다", "에서", "으로", "에게", "까지", "처럼", "보다", "은", "는", "이", "가", "을", "를", "에", "의", "와", "과", "로", "도", "다"];

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

function extractBrandKeywords(value: string, maxItems = 4) {
  const stripSuffix = (token: string) => {
    let next = token;
    for (const suffix of KOREAN_SUFFIXES) {
      if (next.length - suffix.length < 2) {
        continue;
      }
      if (next.endsWith(suffix)) {
        next = next.slice(0, -suffix.length);
        break;
      }
    }
    return next;
  };

  return [...new Set(
    value
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/[^a-zA-Z0-9가-힣\s]/g, " ")
      .split(/\s+/)
      .map((token) => stripSuffix(token.trim()))
      .filter((token) => token.length >= 2)
      .filter((token) => !BRAND_KEYWORD_STOPWORDS.has(token)),
  )].slice(0, maxItems);
}

function hasCtaContext(text: string, cta?: string | null) {
  if (!cta?.trim()) {
    return true;
  }

  const keywords = extractBrandKeywords(cta, 4);
  if (keywords.length === 0) {
    return text.includes(cta.slice(0, 8));
  }

  const matched = keywords.filter((keyword) => text.includes(keyword)).length;
  return matched >= Math.min(2, keywords.length);
}

export function buildReviewSummary(input: ReviewInput): ReviewSummary {
  const findings: ReviewSummary["findings"] = [];
  let brandAlignment = 90;
  let formatFit = 92;
  let ctaClarity = 88;
  let riskControl = 94;
  const brandKeywords = extractBrandKeywords(input.summary);

  for (const asset of input.assets) {
    const matchedBrandKeywords = brandKeywords.filter((keyword) => asset.body.includes(keyword)).length;
    const requiredBrandKeywordMatches = asset.channel === "blog" ? 2 : 1;
    if (brandKeywords.length > 0 && matchedBrandKeywords < Math.min(requiredBrandKeywordMatches, brandKeywords.length)) {
      brandAlignment -= 6;
      findings.push({
        channel: asset.channel,
        type: "brand",
        severity: "warning",
        message: "브랜드 핵심 키워드 문맥이 본문에 충분히 반영되지 않았습니다.",
      });
    }

    if (asset.channel === "instagram" && asset.body.split("\n").length < 4) {
      formatFit -= 8;
      findings.push({
        channel: asset.channel,
        type: "format",
        severity: "warning",
        message: "인스타그램 형식에 맞는 문장 구성이 충분하지 않습니다.",
      });
    }

    if (asset.channel === "facebook" && asset.body.length < 120) {
      formatFit -= 5;
      findings.push({
        channel: asset.channel,
        type: "format",
        severity: "warning",
        message: "페이스북 형식에 비해 본문 길이가 너무 짧습니다.",
      });
    }

    if (asset.channel === "blog") {
      const imageCueCount = (asset.body.match(/\[이미지\s+\d+\]/g) || []).length;
      const requiredSections = ["## 도입", "## 1.", "## 2.", "## 3.", "## 마무리"];
      const missingSections = requiredSections.filter((section) => !asset.body.includes(section));

      if (asset.body.length < NAVER_BLOG_GUIDE.minChars) {
        formatFit -= 12;
        findings.push({
          channel: asset.channel,
          type: "format",
          severity: "warning",
          message: `네이버 블로그 초안 기준에 비해 본문 길이가 짧습니다. 최소 ${NAVER_BLOG_GUIDE.minChars}자 이상으로 보강이 필요합니다.`,
        });
      }

      if (asset.body.length < NAVER_BLOG_GUIDE.targetCharsMin || asset.body.length > NAVER_BLOG_GUIDE.targetCharsMax) {
        formatFit -= 4;
        findings.push({
          channel: asset.channel,
          type: "format",
          severity: "info",
          message: `실무 블로그 작성 가이드 관점에서는 본문을 대체로 ${NAVER_BLOG_GUIDE.targetCharsMin}~${NAVER_BLOG_GUIDE.targetCharsMax}자 범위에서 먼저 검토하는 편이 안정적입니다.`,
        });
      }

      if (imageCueCount < NAVER_BLOG_GUIDE.hardMinImageCues) {
        formatFit -= 10;
        findings.push({
          channel: asset.channel,
          type: "format",
          severity: "warning",
          message: `블로그 본문에 이미지 흐름이 부족합니다. 최소 ${NAVER_BLOG_GUIDE.hardMinImageCues}개 이상은 배치하는 편이 좋습니다.`,
        });
      } else if (
        imageCueCount < NAVER_BLOG_GUIDE.recommendedImageCuesMin ||
        imageCueCount > NAVER_BLOG_GUIDE.recommendedImageCuesMax
      ) {
        formatFit -= 4;
        findings.push({
          channel: asset.channel,
          type: "format",
          severity: "info",
          message: `실무 가이드 기준으로는 본문에 ${NAVER_BLOG_GUIDE.recommendedImageCuesMin}~${NAVER_BLOG_GUIDE.recommendedImageCuesMax}개의 이미지 흐름을 두는 편이 읽기 리듬에 유리합니다.`,
        });
      }

      if (missingSections.length > 0) {
        formatFit -= 8;
        findings.push({
          channel: asset.channel,
          type: "format",
          severity: "warning",
          message: "네이버 블로그용 본문 섹션 구조가 충분하지 않습니다.",
        });
      }

      if (!asset.hashtags?.trim()) {
        formatFit -= 3;
        findings.push({
          channel: asset.channel,
          type: "format",
          severity: "info",
          message: "토픽에 맞는 해시태그를 함께 정리하면 발행 준비와 후속 확장이 더 수월합니다.",
        });
      }
    }

    if (!hasCtaContext(`${asset.cta || ""}\n${asset.body}`, input.cta)) {
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

export function buildSeoComplianceResult(blogAsset: {
  title?: string | null;
  body: string;
  cta?: string | null;
  hashtags?: string | null;
  metaDescription?: string | null;
}): SeoComplianceResult {
  const items: SeoComplianceResult["items"] = [];
  let totalScore = 100;

  // 1. Title length <= 60 chars
  const titleLength = (blogAsset.title || "").length;
  if (titleLength === 0) {
    items.push({
      key: "title-length",
      label: "제목 길이 (60자 이내)",
      status: "fail",
      detail: "제목이 비어 있습니다.",
    });
    totalScore -= 15;
  } else if (titleLength <= 60) {
    items.push({
      key: "title-length",
      label: "제목 길이 (60자 이내)",
      status: "pass",
      detail: `${titleLength}자`,
    });
  } else {
    items.push({
      key: "title-length",
      label: "제목 길이 (60자 이내)",
      status: "warn",
      detail: `${titleLength}자 — 60자 이내로 줄이는 것을 권장합니다.`,
    });
    totalScore -= 8;
  }

  // 2. metaDescription exists and <= 155 chars
  const metaDesc = blogAsset.metaDescription || "";
  if (!metaDesc.trim()) {
    items.push({
      key: "meta-description",
      label: "메타 설명 (155자 이내)",
      status: "fail",
      detail: "메타 설명이 없습니다.",
    });
    totalScore -= 12;
  } else if (metaDesc.length <= 155) {
    items.push({
      key: "meta-description",
      label: "메타 설명 (155자 이내)",
      status: "pass",
      detail: `${metaDesc.length}자`,
    });
  } else {
    items.push({
      key: "meta-description",
      label: "메타 설명 (155자 이내)",
      status: "warn",
      detail: `${metaDesc.length}자 — 155자 이내로 줄이는 것을 권장합니다.`,
    });
    totalScore -= 6;
  }

  // 3. H1 count == 1 (## 도입 counts as H1 equivalent)
  const h1Matches = blogAsset.body.match(/^## 도입/gm) || [];
  const h1Count = h1Matches.length;
  if (h1Count === 1) {
    items.push({
      key: "h1-count",
      label: "H1 태그 (1개)",
      status: "pass",
      detail: "H1(## 도입) 1개 확인",
    });
  } else if (h1Count === 0) {
    items.push({
      key: "h1-count",
      label: "H1 태그 (1개)",
      status: "fail",
      detail: "H1(## 도입) 태그가 없습니다.",
    });
    totalScore -= 10;
  } else {
    items.push({
      key: "h1-count",
      label: "H1 태그 (1개)",
      status: "warn",
      detail: `H1(## 도입)이 ${h1Count}개입니다. 1개를 권장합니다.`,
    });
    totalScore -= 5;
  }

  // 4. H2/H3 hierarchy present
  const h2Matches = blogAsset.body.match(/^## /gm) || [];
  const h3Matches = blogAsset.body.match(/^### /gm) || [];
  const h2Count = h2Matches.length;
  const h3Count = h3Matches.length;
  if (h2Count >= 2) {
    items.push({
      key: "heading-hierarchy",
      label: "H2/H3 계층 구조",
      status: "pass",
      detail: `H2 ${h2Count}개, H3 ${h3Count}개`,
    });
  } else {
    items.push({
      key: "heading-hierarchy",
      label: "H2/H3 계층 구조",
      status: "warn",
      detail: `H2 ${h2Count}개 — 최소 2개 이상의 소제목을 권장합니다.`,
    });
    totalScore -= 8;
  }

  // 5. Keyword density 1-2% (extract keywords from title, check in body)
  const titleKeywords = extractBrandKeywords(blogAsset.title || "", 3);
  if (titleKeywords.length > 0) {
    const bodyLength = blogAsset.body.length;
    const totalKeywordChars = titleKeywords.reduce((sum, kw) => {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const matches = blogAsset.body.match(regex) || [];
      return sum + matches.length * kw.length;
    }, 0);
    const density = bodyLength > 0 ? (totalKeywordChars / bodyLength) * 100 : 0;

    if (density >= 1 && density <= 2) {
      items.push({
        key: "keyword-density",
        label: "키워드 밀도 (1-2%)",
        status: "pass",
        detail: `${density.toFixed(1)}%`,
      });
    } else if (density > 0 && density < 1) {
      items.push({
        key: "keyword-density",
        label: "키워드 밀도 (1-2%)",
        status: "warn",
        detail: `${density.toFixed(1)}% — 키워드 빈도가 다소 낮습니다.`,
      });
      totalScore -= 5;
    } else if (density > 2) {
      items.push({
        key: "keyword-density",
        label: "키워드 밀도 (1-2%)",
        status: "warn",
        detail: `${density.toFixed(1)}% — 키워드가 과다합니다.`,
      });
      totalScore -= 5;
    } else {
      items.push({
        key: "keyword-density",
        label: "키워드 밀도 (1-2%)",
        status: "fail",
        detail: "제목 키워드가 본문에 나타나지 않습니다.",
      });
      totalScore -= 10;
    }
  } else {
    items.push({
      key: "keyword-density",
      label: "키워드 밀도 (1-2%)",
      status: "warn",
      detail: "제목에서 키워드를 추출할 수 없습니다.",
    });
    totalScore -= 5;
  }

  // 6. Body length 1500-2500 chars
  const bodyLength = blogAsset.body.length;
  if (bodyLength >= 1500 && bodyLength <= 2500) {
    items.push({
      key: "body-length",
      label: "본문 길이 (1500-2500자)",
      status: "pass",
      detail: `${bodyLength}자`,
    });
  } else if (bodyLength < 1500) {
    items.push({
      key: "body-length",
      label: "본문 길이 (1500-2500자)",
      status: bodyLength < 1000 ? "fail" : "warn",
      detail: `${bodyLength}자 — 1500자 이상으로 보강을 권장합니다.`,
    });
    totalScore -= bodyLength < 1000 ? 15 : 8;
  } else {
    items.push({
      key: "body-length",
      label: "본문 길이 (1500-2500자)",
      status: "warn",
      detail: `${bodyLength}자 — 2500자 이내로 줄이는 것을 권장합니다.`,
    });
    totalScore -= 5;
  }

  // 7. Image cues [이미지 N] 3-5 count
  const imageCues = blogAsset.body.match(/\[이미지\s+\d+\]/g) || [];
  const imageCueCount = imageCues.length;
  if (imageCueCount >= 3 && imageCueCount <= 5) {
    items.push({
      key: "image-cues",
      label: "이미지 배치 (3-5개)",
      status: "pass",
      detail: `${imageCueCount}개`,
    });
  } else if (imageCueCount < 3) {
    items.push({
      key: "image-cues",
      label: "이미지 배치 (3-5개)",
      status: imageCueCount === 0 ? "fail" : "warn",
      detail: `${imageCueCount}개 — 최소 3개 이상 배치를 권장합니다.`,
    });
    totalScore -= imageCueCount === 0 ? 12 : 6;
  } else {
    items.push({
      key: "image-cues",
      label: "이미지 배치 (3-5개)",
      status: "warn",
      detail: `${imageCueCount}개 — 5개 이내로 조정을 권장합니다.`,
    });
    totalScore -= 3;
  }

  // 8. Paragraph length (each paragraph <= 150 chars, 3-4 sentences)
  const paragraphs = blogAsset.body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("##") && !p.startsWith("[이미지") && !p.startsWith("- "));
  const longParagraphs = paragraphs.filter((p) => p.length > 150);
  if (paragraphs.length === 0) {
    items.push({
      key: "paragraph-length",
      label: "문단 길이 (150자 이내)",
      status: "warn",
      detail: "문단을 구분할 수 없습니다.",
    });
    totalScore -= 5;
  } else if (longParagraphs.length === 0) {
    items.push({
      key: "paragraph-length",
      label: "문단 길이 (150자 이내)",
      status: "pass",
      detail: `전체 ${paragraphs.length}개 문단 모두 적정 길이`,
    });
  } else {
    const ratio = longParagraphs.length / paragraphs.length;
    items.push({
      key: "paragraph-length",
      label: "문단 길이 (150자 이내)",
      status: ratio > 0.5 ? "fail" : "warn",
      detail: `${paragraphs.length}개 문단 중 ${longParagraphs.length}개가 150자 초과`,
    });
    totalScore -= ratio > 0.5 ? 10 : 5;
  }

  // 9. Section count 3-5 (H2 sections)
  const h2Sections = (blogAsset.body.match(/^## /gm) || []).length;
  if (h2Sections >= 3 && h2Sections <= 5) {
    items.push({
      key: "section-count",
      label: "섹션 수 (3-5개)",
      status: "pass",
      detail: `${h2Sections}개 섹션`,
    });
  } else if (h2Sections < 3) {
    items.push({
      key: "section-count",
      label: "섹션 수 (3-5개)",
      status: "warn",
      detail: `${h2Sections}개 — 최소 3개 이상의 섹션을 권장합니다.`,
    });
    totalScore -= 6;
  } else {
    items.push({
      key: "section-count",
      label: "섹션 수 (3-5개)",
      status: "warn",
      detail: `${h2Sections}개 — 5개 이내로 정리를 권장합니다.`,
    });
    totalScore -= 3;
  }

  return {
    score: clampScore(totalScore),
    items,
  };
}
