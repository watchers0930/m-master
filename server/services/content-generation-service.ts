import { logger } from "../logger";
import { buildStudioSeed, type StudioSeed } from "./studio-seed-service";

export type ContentGenerationProvider = "openai" | "fallback";

type BrandProfileSeed = {
  summary: string;
  audience: string | null;
  tone: string | null;
  cta: string | null;
  bannedTerms: string | null;
};

type TopicSeed = {
  title: string;
  score: number | null;
};

const OPENAI_TEXT_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini";
const KOREAN_SUFFIXES = ["입니다", "하는", "하다", "에서", "으로", "에게", "까지", "처럼", "보다", "은", "는", "이", "가", "을", "를", "에", "의", "와", "과", "로", "도", "다"];
const NAVER_BLOG_TARGET = {
  minChars: 1500,
  maxChars: 2200,
} as const;
const INDUSTRY_PROMPT_HINTS = {
  "real-estate": [
    "- 부동산 업종은 신뢰감, 판단 기준, 실제 확인 포인트를 먼저 제시한다.",
    "- 과장 표현보다 비교 기준, 체크 포인트, 적용 장면 중심으로 설명한다.",
  ],
  marketing: [
    "- 마케팅 업종은 전환 흐름, 메시지 일관성, 채널 확장 관점을 함께 보여준다.",
    "- 실행 포인트와 운영 효율을 짧게 끊어 설명한다.",
  ],
  saas: [
    "- SaaS 업종은 기능 나열보다 사용 흐름, 팀 적용 방식, 운영 효율을 먼저 설명한다.",
    "- 설정, 실행, 확인처럼 단계형 구조를 선호한다.",
  ],
  finance: [
    "- 금융 업종은 리스크, 판단 근거, 검토 기준을 명확히 보여준다.",
    "- 확정적 표현보다 보수적이고 구조적인 설명을 유지한다.",
  ],
} as const;
const CHANNEL_FEW_SHOTS = {
  blog: {
    title: "도입 전에 체크해야 할 업무 자동화 흐름 정리",
    body: [
      "## 도입",
      "업무 자동화 도구를 처음 검토할 때는 기능 수보다 실제 흐름이 먼저 보이는지가 중요합니다. 그래서 이 글은 무엇을 자동화할 수 있는지보다, 어떤 순서로 이해하면 되는지부터 정리합니다.",
      "",
      "[이미지 1] 전체 흐름을 요약한 대표 이미지",
      "",
      "## 1. 먼저 확인할 핵심",
      "첫 단계에서는 반복 업무가 어디서 생기는지 확인합니다. 이 지점을 먼저 잡아야 도구 설명이 길어지지 않고, 독자도 자신과 관련 있는 내용을 빠르게 구분할 수 있습니다.",
      "",
      "[이미지 2] 반복 업무 구간을 표시한 예시 이미지",
      "",
      "## 2. 실제 사용 흐름",
      "다음으로는 설정, 실행, 확인 순서로 흐름을 보여주는 편이 좋습니다. 각 단계가 한 문단 안에서 끝나야 모바일에서도 읽기 부담이 적습니다.",
      "",
      "[이미지 3] 단계별 사용 흐름 이미지",
      "",
      "## 3. 실무 적용 포인트",
      "도구 소개는 결국 적용 가능성이 보여야 설득력이 생깁니다. 어떤 팀이 바로 써볼 수 있는지, 적용 전에 무엇을 체크해야 하는지까지 함께 적는 편이 실무형 글에 가깝습니다.",
      "",
      "[이미지 4] 적용 체크 포인트 이미지",
      "",
      "## 마무리",
      "핵심은 기능 설명을 길게 늘어놓는 것이 아니라, 읽는 사람이 바로 다음 행동을 떠올릴 수 있게 정리하는 것입니다. 자세한 정보는 공식 안내와 체크리스트로 자연스럽게 이어지게 마무리합니다.",
    ].join("\n"),
    cta: "자세한 기능과 적용 방법은 공식 안내에서 확인하고, 체크리스트부터 바로 점검해 보세요.",
    hashtags: "#업무자동화, #운영효율, #실무가이드, #콘텐츠기획",
  },
  instagram: {
    title: "업무 자동화 흐름 한눈에 보기",
    body: [
      "1장. 반복 업무를 먼저 찾으면 자동화가 쉬워집니다.",
      "2장. 핵심은 기능보다 흐름입니다.",
      "3장. 설정, 실행, 확인 순서로 보여주면 이해가 빨라집니다.",
      "4장. 실무 팀은 이 구조만 잡아도 적용 판단이 쉬워집니다.",
      "5장. 자세한 내용은 체크리스트와 함께 바로 확인해 보세요.",
    ].join("\n"),
    cta: "핵심 흐름을 먼저 보고, 체크리스트로 바로 적용해 보세요.",
    hashtags: "#업무자동화, #실무팁, #콘텐츠전환, #운영전략",
  },
  facebook: {
    title: "업무 자동화 흐름을 먼저 정리해야 하는 이유",
    body: [
      "업무 자동화는 기능이 많다고 바로 잘 쓰이는 것이 아닙니다. 먼저 어떤 흐름을 줄일 수 있는지 보이는지가 더 중요합니다.",
      "",
      "설정, 실행, 확인 순서로 정리하면 처음 보는 사람도 부담 없이 이해할 수 있습니다. 긴 설명보다 짧은 문단으로 핵심을 나누는 편이 좋습니다.",
      "",
      "실무 팀은 이 구조를 기준으로 바로 내부 문서나 콘텐츠로 전환할 수 있습니다. 같은 내용을 여러 채널에 나눠 쓰기에도 유리합니다.",
      "",
      "자세한 내용은 공식 안내와 체크리스트를 함께 보면서 적용 흐름까지 확인해 보세요.",
    ].join("\n"),
    cta: "공식 안내와 체크리스트를 함께 보며 적용 흐름을 확인해 보세요.",
    hashtags: "#업무자동화, #운영효율, #실무가이드, #콘텐츠운영",
  },
} satisfies Record<"blog" | "instagram" | "facebook", Omit<GeneratedAsset, "channel">>;

type GeneratedAsset = {
  channel: "blog" | "instagram" | "facebook";
  title: string;
  body: string;
  cta: string;
  hashtags: string;
  metaDescription?: string;
};

type GeneratedStudioPayload = {
  objective?: string;
  assets?: GeneratedAsset[];
};

type GeneratedChannelPayload = {
  objective?: string;
  title?: string;
  body?: string;
  cta?: string;
  hashtags?: string;
  metaDescription?: string;
};

function canUseOpenAiText() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function cleanLine(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function extractTextFromResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
        value?: string;
      }>;
    }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  return (
    record.output
      ?.flatMap((item) => item.content || [])
      .map((item) => item.text || item.value || "")
      .join("\n")
      .trim() || ""
  );
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

function normalizeHashtagList(value: string) {
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.startsWith("#") ? item : `#${item}`)),
  )]
    .slice(0, 8)
    .join(", ");
}

function extractKeywordHints(value: string, maxItems = 3) {
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
      .filter((token) => !["그리고", "중심", "기준", "콘텐츠", "서비스", "프로젝트", "마케팅"].includes(token)),
  )].slice(0, maxItems);
}

function ensureBrandContext(body: string, summary?: string | null) {
  const keywords = extractKeywordHints(summary || "", 2);
  if (keywords.length === 0) {
    return body;
  }

  const hasEnoughKeywords = keywords.filter((keyword) => body.includes(keyword)).length >= Math.min(2, keywords.length);
  if (hasEnoughKeywords) {
    return body;
  }

  return `${body}\n\n핵심 맥락: ${keywords.join(", ")} 중심으로 이해하면 좋다.`.trim();
}

function ensureCtaPresence(body: string, cta: string) {
  const anchor = cleanLine(cta, 120).slice(0, 8);
  if (anchor && body.includes(anchor)) {
    return body;
  }

  return `${body}\n\n${cta}`.trim();
}

function ensureBlogImageFlow(body: string) {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  const next: string[] = [];
  let imageCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd() || "";
    next.push(line);

    if (line.startsWith("[이미지 ")) {
      imageCount += 1;
      continue;
    }

    const nextLine = lines[index + 1]?.trim() || "";
    if (!/^## /.test(line) || /^## 마무리/.test(line) || nextLine.startsWith("[이미지 ")) {
      continue;
    }

    if (imageCount >= 5) {
      continue;
    }

    next.push("");
    next.push(`[이미지 ${imageCount + 1}] 위 섹션 핵심을 시각적으로 요약하는 이미지`);
    next.push("");
    imageCount += 1;
  }

  return next.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ensureBlogLength(body: string, profile: BrandProfileSeed, topic: string, cta: string) {
  const normalized = body.trim();
  if (normalized.length >= NAVER_BLOG_TARGET.minChars) {
    return normalized.slice(0, NAVER_BLOG_TARGET.maxChars).trim();
  }

  const audience = cleanLine(profile.audience || "실무 팀과 잠재 고객이 빠르게 이해하고 바로 활용할 수 있어야 한다.", 120);
  const tone = cleanLine(profile.tone || "짧은 문장으로 핵심을 먼저 보여주고 구조적으로 정리한다.", 120);
  const supplement = [
    "## 4. 활용 전에 체크할 부분",
    `${topic}를 소개할 때는 정보가 많아 보이는 것보다, 실제로 어디서부터 읽으면 되는지가 더 중요합니다. 특히 ${audience} 같은 독자는 첫 화면에서 핵심을 이해하고 다음 단계로 바로 넘어갈 수 있어야 합니다.`,
    `${tone} 원칙을 유지하면 글이 길어져도 흐름이 무너지지 않습니다. 각 문단이 하나의 질문에 답하도록 구성하고, 이미지도 같은 메시지를 보강하도록 맞추면 읽는 속도가 안정됩니다.`,
    "",
    "[이미지 6] 실제 활용 전에 체크할 포인트를 정리한 보조 이미지",
    "",
  ].join("\n");

  const expanded = normalized.includes("## 마무리")
    ? normalized.replace("## 마무리", `${supplement}## 마무리`)
    : `${normalized}\n\n${supplement}`;

  if (expanded.length >= NAVER_BLOG_TARGET.minChars) {
    return expanded.slice(0, NAVER_BLOG_TARGET.maxChars).trim();
  }

  return `${expanded}\n\n${cta}`.slice(0, NAVER_BLOG_TARGET.maxChars).trim();
}

function normalizeAsset(
  channel: "blog" | "instagram" | "facebook",
  asset: GeneratedAsset | undefined,
  fallback: StudioSeed["assets"][number],
  profile: BrandProfileSeed,
) {
  const cta = cleanLine(asset?.cta || fallback.cta, 1000) || fallback.cta;
  let body = (asset?.body || fallback.body).trim();

  if (!asset) {
    body = ensureBrandContext(body, profile.summary);
  }
  if (channel === "blog") {
    body = ensureBlogImageFlow(body);
    body = ensureBlogLength(body, profile, fallback.title, cta);
  } else {
    body = ensureCtaPresence(body, cta);
  }

  const result: GeneratedAsset = {
    channel,
    title: cleanLine(asset?.title || fallback.title, 300) || fallback.title,
    body,
    cta,
    hashtags: normalizeHashtagList(asset?.hashtags || fallback.hashtags || ""),
  };

  if (channel === "blog" && asset?.metaDescription) {
    result.metaDescription = cleanLine(asset.metaDescription, 155);
  }

  return result;
}

function buildSharedContext(params: {
  projectName: string;
  industry?: string | null;
  topic: string;
  profile: BrandProfileSeed;
}) {
  return `
[브랜드]
- 프로젝트명: ${params.projectName}
- 업종: ${params.industry || "general"}
- 주제: ${params.topic}
- 브랜드 요약: ${params.profile.summary}
- 핵심 타겟: ${params.profile.audience || ""}
- 톤: ${params.profile.tone || ""}
- CTA 방향: ${params.profile.cta || ""}
- 금지 표현: ${params.profile.bannedTerms || ""}
`.trim();
}

function buildChannelPrompt(params: {
  channel: "blog" | "instagram" | "facebook";
  projectName: string;
  industry?: string | null;
  topic: string;
  profile: BrandProfileSeed;
  fallbackAsset: StudioSeed["assets"][number];
  fallbackObjective: string;
}) {
  const shared = buildSharedContext(params);
  const example = CHANNEL_FEW_SHOTS[params.channel];
  const industryHints =
    params.industry && params.industry in INDUSTRY_PROMPT_HINTS
      ? INDUSTRY_PROMPT_HINTS[params.industry as keyof typeof INDUSTRY_PROMPT_HINTS]
      : ["- 업종 특성에 맞는 설명 순서와 예시를 선택하되, 과장 없이 실무형 문장으로 쓴다."];
  const channelRules =
    params.channel === "blog"
      ? [
          "- 출력은 반드시 JSON만 반환한다.",
          "- blog는 네이버 블로그용 초안으로 작성한다.",
          '- 소제목은 "## 도입", "## 1. ...", "## 2. ...", "## 3. ...", "## 마무리" 형식을 우선 사용한다.',
          "- 각 주요 섹션 설명 다음에는 반드시 [이미지 N] 한 줄을 붙여 글-이미지-글-이미지 흐름을 만든다.",
          "- [이미지 1]부터 [이미지 5]까지 자연스럽게 배치하고, 각 이미지는 바로 앞 문단 내용을 요약해야 한다.",
          "- 4~5개 섹션 안팎으로 구성하고, 각 문단은 2~3문장 정도로 짧게 끊는다.",
          "- 블로그 본문은 대체로 1500~2200자 범위에서 작성한다.",
          "- 너무 짧게 끝내지 말고, 실무 적용 포인트나 체크 포인트를 포함한다.",
          "- 브랜드 요약 문장을 그대로 길게 복사하지 말고, 핵심 의미만 자연스럽게 풀어서 쓴다.",
          "- 같은 표현을 반복해서 붙이지 말고, URL이나 도메인 문자열을 본문에 여러 번 반복하지 않는다.",
          "- title은 60자 이내, 핵심 키워드를 앞배치한다.",
          "- meta_description은 155자 이내 요약을 함께 작성한다. JSON에 \"metaDescription\" 필드로 반환한다.",
          "- H1 1개 + H2/H3 계층 구조를 유지한다.",
          "- 키워드 밀도 1-2%를 목표로 한다.",
          "- 본문에 [이미지 N]을 3-5개 배치하고, 각 줄에서 이미지가 어떤 장면인지 짧게 설명한다.",
          "- 네이버 블로그 최적화 관점에서 긴 벽문단을 피하고, 모바일에서 스크롤할 때 리듬감 있게 읽히도록 쓴다.",
        ]
      : params.channel === "instagram"
        ? [
            "- 출력은 반드시 JSON만 반환한다.",
            "- instagram은 5장 카드뉴스 초안처럼 작성한다.",
            "- 각 줄은 1장씩 쓰고, 각 장은 한 문장 위주로 짧고 명확하게 쓴다.",
            "- 브랜드 핵심 요약과 CTA 문맥이 직접 드러나야 한다.",
            "- 도메인/URL 반복은 최소화한다.",
          ]
        : [
            "- 출력은 반드시 JSON만 반환한다.",
            "- facebook은 링크 포스트형 짧은 문안으로 작성한다.",
            "- 3~5개의 짧은 문단으로 나누고, 첫 문단에서 주제를 바로 설명한다.",
            "- 브랜드 핵심 요약과 CTA 문맥이 직접 드러나야 한다.",
            "- 과장 없이 읽기 좋은 한국어 문장으로 쓴다.",
          ];

  return `
너는 한국어 콘텐츠 마케터다. 아래 브랜드 컨텍스트를 기준으로 ${params.channel} 채널 초안을 작성한다.

${shared}

[작성 원칙]
${channelRules.join("\n")}
${industryHints.join("\n")}
- hashtags는 쉼표로 구분된 해시태그 문자열로 작성한다.
- hashtags는 브랜드/주제/업종에 맞게 4~6개로 작성한다.

[JSON 스키마]
{
  "objective": "string",
  "title": "string",
  "body": "string",
  "cta": "string",
  "hashtags": "#a, #b"${params.channel === "blog" ? ',\n  "metaDescription": "string"' : ""}
}

[참고용 기본 목표]
${params.fallbackObjective}

[좋은 ${params.channel} 출력 예시]
${JSON.stringify(example, null, 2)}

[참고용 기존 ${params.channel} 초안]
${JSON.stringify(params.fallbackAsset, null, 2)}
`.trim();
}

async function requestOpenAiDraft(prompt: string) {
  const response = await fetch(OPENAI_TEXT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      input: prompt,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI text request failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const text = extractTextFromResponse(payload);
  if (!text) {
    throw new Error("OpenAI text response was empty.");
  }

  return JSON.parse(extractJsonObject(text)) as GeneratedStudioPayload | GeneratedChannelPayload;
}

export async function buildGeneratedStudioSeed(params: {
  projectName: string;
  industry?: string | null;
  profile: BrandProfileSeed;
  topics: TopicSeed[];
}) {
  const fallback = buildStudioSeed(params);

  if (!canUseOpenAiText()) {
    return {
      provider: "fallback" as const,
      seed: fallback,
    };
  }

  try {
    const channels: Array<"blog" | "instagram" | "facebook"> = ["blog", "instagram", "facebook"];
    const generatedAssets = await Promise.all(
      channels.map(async (channel) => {
        const fallbackAsset = fallback.assets.find((asset) => asset.channel === channel)!;
        const payload = (await requestOpenAiDraft(
          buildChannelPrompt({
            channel,
            projectName: params.projectName,
            industry: params.industry,
            topic: fallback.topic,
            profile: params.profile,
            fallbackAsset,
            fallbackObjective: fallback.objective,
          }),
        )) as GeneratedChannelPayload;

        const generatedAsset: GeneratedAsset = {
          channel,
          title: payload.title || fallbackAsset.title,
          body: payload.body || fallbackAsset.body,
          cta: payload.cta || fallbackAsset.cta,
          hashtags: payload.hashtags || fallbackAsset.hashtags,
        };

        if (channel === "blog" && payload.metaDescription) {
          generatedAsset.metaDescription = payload.metaDescription;
        }

        return {
          objective: payload.objective,
          asset: generatedAsset,
        };
      }),
    );

    const assetMap = new Map(generatedAssets.map((item) => [item.asset.channel, item.asset]));
    const objective = generatedAssets.find((item) => item.objective?.trim())?.objective;
    return {
      provider: "openai" as const,
      seed: {
        topic: fallback.topic,
        objective: cleanLine(objective || fallback.objective, 1000) || fallback.objective,
        assets: [
          normalizeAsset("blog", assetMap.get("blog"), fallback.assets.find((asset) => asset.channel === "blog")!, params.profile),
          normalizeAsset(
            "instagram",
            assetMap.get("instagram"),
            fallback.assets.find((asset) => asset.channel === "instagram")!,
            params.profile,
          ),
          normalizeAsset(
            "facebook",
            assetMap.get("facebook"),
            fallback.assets.find((asset) => asset.channel === "facebook")!,
            params.profile,
          ),
        ],
      } satisfies StudioSeed,
    };
  } catch (error) {
    logger.error("content.generation.openai.failed", {
      projectName: params.projectName,
      topic: fallback.topic,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return {
      provider: "fallback" as const,
      seed: fallback,
    };
  }
}

export type VariantAngle = "practical" | "data" | "qa";

const VARIANT_ANGLE_INSTRUCTIONS: Record<VariantAngle, string> = {
  practical:
    "실제 운영 사례, 적용 경험담, 현장에서 바로 확인한 결과를 중심으로 전개한다. 추상적 설명 대신 구체적 실행 단계를 보여준다.",
  data:
    "수치, 비율, 비교 데이터를 앞세운다. '30% 절감', '2배 단축' 같은 정량 표현을 활용하고, 통계와 그래프 설명을 본문 흐름에 포함한다.",
  qa:
    "독자가 자주 묻는 질문을 소제목으로 사용하고, 바로 답변 구조로 전개한다. 'Q. ~?', 'A. ~' 형식이 아니라 질문형 소제목 + 답변 문단 구조를 쓴다.",
};

const VARIANT_ANGLE_LABELS: Record<VariantAngle, string> = {
  practical: "실무 사례",
  data: "데이터 중심",
  qa: "Q&A 구조",
};

function buildDerivedChannelPrompt(params: {
  channel: "instagram" | "facebook";
  blogContent: { title: string; body: string; cta: string; hashtags: string };
  profile: BrandProfileSeed;
}) {
  const channelRules =
    params.channel === "instagram"
      ? [
          "- 출력은 반드시 JSON만 반환한다.",
          "- instagram은 5장 카드뉴스 초안처럼 작성한다.",
          "- 각 줄은 1장씩 쓰고, 각 장은 한 문장 위주로 짧고 명확하게 쓴다.",
          "- 브랜드 핵심 요약과 CTA 문맥이 직접 드러나야 한다.",
          "- 도메인/URL 반복은 최소화한다.",
        ]
      : [
          "- 출력은 반드시 JSON만 반환한다.",
          "- facebook은 링크 포스트형 짧은 문안으로 작성한다.",
          "- 3~5개의 짧은 문단으로 나누고, 첫 문단에서 주제를 바로 설명한다.",
          "- 브랜드 핵심 요약과 CTA 문맥이 직접 드러나야 한다.",
          "- 과장 없이 읽기 좋은 한국어 문장으로 쓴다.",
        ];

  return `
너는 한국어 콘텐츠 마케터다. 아래 블로그 원문을 기반으로 ${params.channel} 채널에 맞게 변환한다.
블로그 원문을 독립적으로 다시 작성하지 말고, 원문의 핵심 메시지와 구조를 ${params.channel} 형식에 맞춰 재구성한다.

[블로그 원문]
제목: ${params.blogContent.title}
본문: ${params.blogContent.body.slice(0, 2000)}
CTA: ${params.blogContent.cta}

[브랜드 톤]
- 톤: ${params.profile.tone || ""}
- CTA 방향: ${params.profile.cta || ""}

[작성 원칙]
${channelRules.join("\n")}
- hashtags는 쉼표로 구분된 해시태그 문자열로 작성한다.
- hashtags는 브랜드/주제/업종에 맞게 4~6개로 작성한다.

[JSON 스키마]
{
  "title": "string",
  "body": "string",
  "cta": "string",
  "hashtags": "#a, #b"
}
`.trim();
}

export async function buildDerivedChannelAssets(params: {
  blogAsset: { title: string; body: string; cta: string; hashtags: string };
  projectName: string;
  industry?: string | null;
  profile: BrandProfileSeed;
}): Promise<{ provider: ContentGenerationProvider; assets: GeneratedAsset[] }> {
  const fallbackSeed = buildStudioSeed({
    projectName: params.projectName,
    industry: params.industry,
    profile: params.profile,
    topics: [{ title: params.blogAsset.title, score: 10 }],
  });

  if (!canUseOpenAiText()) {
    return {
      provider: "fallback",
      assets: [
        normalizeAsset(
          "instagram",
          undefined,
          fallbackSeed.assets.find((a) => a.channel === "instagram")!,
          params.profile,
        ),
        normalizeAsset(
          "facebook",
          undefined,
          fallbackSeed.assets.find((a) => a.channel === "facebook")!,
          params.profile,
        ),
      ],
    };
  }

  try {
    const channels: Array<"instagram" | "facebook"> = ["instagram", "facebook"];
    const derivedAssets = await Promise.all(
      channels.map(async (channel) => {
        const fallbackAsset = fallbackSeed.assets.find((a) => a.channel === channel)!;
        const payload = (await requestOpenAiDraft(
          buildDerivedChannelPrompt({
            channel,
            blogContent: params.blogAsset,
            profile: params.profile,
          }),
        )) as GeneratedChannelPayload;

        return normalizeAsset(
          channel,
          {
            channel,
            title: payload.title || fallbackAsset.title,
            body: payload.body || fallbackAsset.body,
            cta: payload.cta || fallbackAsset.cta,
            hashtags: payload.hashtags || fallbackAsset.hashtags,
          },
          fallbackAsset,
          params.profile,
        );
      }),
    );

    return {
      provider: "openai",
      assets: derivedAssets,
    };
  } catch (error) {
    logger.error("content.derivation.openai.failed", {
      projectName: params.projectName,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return {
      provider: "fallback",
      assets: [
        normalizeAsset(
          "instagram",
          undefined,
          fallbackSeed.assets.find((a) => a.channel === "instagram")!,
          params.profile,
        ),
        normalizeAsset(
          "facebook",
          undefined,
          fallbackSeed.assets.find((a) => a.channel === "facebook")!,
          params.profile,
        ),
      ],
    };
  }
}

export async function buildVariantStudioSeed(params: {
  projectName: string;
  industry?: string | null;
  profile: BrandProfileSeed;
  topics: TopicSeed[];
  angle: VariantAngle;
}): Promise<{ provider: ContentGenerationProvider; seed: StudioSeed; variantLabel: string }> {
  const fallback = buildStudioSeed(params);
  const variantLabel = VARIANT_ANGLE_LABELS[params.angle];

  if (!canUseOpenAiText()) {
    return {
      provider: "fallback",
      seed: fallback,
      variantLabel,
    };
  }

  try {
    const blogFallbackAsset = fallback.assets.find((a) => a.channel === "blog")!;
    const angleInstruction = VARIANT_ANGLE_INSTRUCTIONS[params.angle];

    const blogPrompt = buildChannelPrompt({
      channel: "blog",
      projectName: params.projectName,
      industry: params.industry,
      topic: fallback.topic,
      profile: params.profile,
      fallbackAsset: blogFallbackAsset,
      fallbackObjective: fallback.objective,
    });

    const enhancedBlogPrompt = blogPrompt.replace(
      "[작성 원칙]",
      `[작성 관점]\n- ${angleInstruction}\n\n[작성 원칙]`,
    );

    const blogPayload = (await requestOpenAiDraft(enhancedBlogPrompt)) as GeneratedChannelPayload;
    const blogAsset: GeneratedAsset = {
      channel: "blog",
      title: blogPayload.title || blogFallbackAsset.title,
      body: blogPayload.body || blogFallbackAsset.body,
      cta: blogPayload.cta || blogFallbackAsset.cta,
      hashtags: blogPayload.hashtags || blogFallbackAsset.hashtags,
    };

    if (blogPayload.metaDescription) {
      blogAsset.metaDescription = blogPayload.metaDescription;
    }

    const normalizedBlog = normalizeAsset("blog", blogAsset, blogFallbackAsset, params.profile);

    const derived = await buildDerivedChannelAssets({
      blogAsset: {
        title: normalizedBlog.title,
        body: normalizedBlog.body,
        cta: normalizedBlog.cta,
        hashtags: normalizedBlog.hashtags,
      },
      projectName: params.projectName,
      industry: params.industry,
      profile: params.profile,
    });

    const objective = blogPayload.objective
      ? cleanLine(blogPayload.objective, 1000)
      : fallback.objective;

    return {
      provider: "openai",
      seed: {
        topic: fallback.topic,
        objective: objective || fallback.objective,
        assets: [
          normalizedBlog,
          ...derived.assets,
        ],
      },
      variantLabel,
    };
  } catch (error) {
    logger.error("content.variant.openai.failed", {
      projectName: params.projectName,
      angle: params.angle,
      topic: fallback.topic,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return {
      provider: "fallback",
      seed: fallback,
      variantLabel,
    };
  }
}
