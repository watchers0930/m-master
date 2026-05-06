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
  "vestra",
  "plum",
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
