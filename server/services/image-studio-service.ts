type ImageChannel = "blog" | "instagram" | "facebook";

type AssetSeed = {
  channel: ImageChannel;
  title: string;
  body: string;
  cta: string;
};

type ImageVariantRecord = {
  role: string;
  originalPath: string;
  composedPath: string;
  width: number;
  height: number;
  selected: boolean;
};

const PRESET_MAP: Record<ImageChannel, { width: number; height: number; label: string }> = {
  blog: { width: 1200, height: 628, label: "Blog Hero" },
  instagram: { width: 1080, height: 1080, label: "Instagram Square" },
  facebook: { width: 1200, height: 630, label: "Facebook Link" },
};

const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";
const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_QUALITY = "low";
const OPENAI_VARIANT_COUNT = 1;
const VARIANT_DIRECTIONS = [
  "제품 핵심 메시지를 정면으로 전달하는 선명한 히어로형 구도",
  "신뢰감 있는 카드형 정보 구조와 여백 중심의 에디토리얼 구도",
  "행동 유도를 강조하는 CTA 중심 캠페인 배너 구도",
] as const;

function toSentence(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractBlogImageCues(body: string) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[이미지 "))
    .map((line) => line.replace(/^\[이미지\s+\d+\]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildImagePrompt(projectName: string, asset: AssetSeed) {
  const title = toSentence(asset.title, 90);
  const summary = toSentence(asset.body, 180);
  const blogImageCues = asset.channel === "blog" ? extractBlogImageCues(asset.body) : [];
  const cueSummary = blogImageCues.length > 0 ? `섹션 이미지 힌트: ${blogImageCues.join(" / ")}.` : "";
  return `${projectName} ${asset.channel} 이미지. 제목은 "${title}", 핵심 메시지는 "${summary}", CTA는 "${toSentence(asset.cta, 80)}". ${cueSummary} 네이버 블로그용 정보형 에디토리얼 비주얼, 문단 사이에 자연스럽게 들어갈 실사풍 또는 인포그래픽 스타일, 미니멀, 선명한 대비, 블루 포인트.`;
}

function toOpenAiSize(channel: ImageChannel) {
  if (channel === "instagram") {
    return "1024x1024";
  }

  return "1536x1024";
}

function canUseOpenAiImage() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function buildSvgVariant(params: {
  projectName: string;
  asset: AssetSeed;
  variantIndex: number;
}) {
  const preset = PRESET_MAP[params.asset.channel];
  const title = toSentence(params.asset.title, 44);
  const summary = toSentence(params.asset.body, 120);
  const accents = [
    { a: "#0071E3", b: "#DCEBFF", c: "#1D1D1F" },
    { a: "#1D1D1F", b: "#EEF3FA", c: "#0071E3" },
    { a: "#0F62FE", b: "#E8F0FF", c: "#111827" },
  ];
  const palette = accents[params.variantIndex % accents.length];
  const shapes = [
    `<circle cx="${preset.width - 120}" cy="110" r="92" fill="${palette.b}" />`,
    `<rect x="${preset.width - 260}" y="58" width="180" height="180" rx="36" fill="${palette.b}" />`,
    `<path d="M${preset.width - 280},60 C${preset.width - 60},60 ${preset.width - 80},250 ${preset.width - 250},250 Z" fill="${palette.b}" />`,
  ];

  return svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${preset.width}" height="${preset.height}" viewBox="0 0 ${preset.width} ${preset.height}">
      <rect width="100%" height="100%" rx="32" fill="#FFFFFF" />
      <rect x="36" y="36" width="${preset.width - 72}" height="${preset.height - 72}" rx="28" fill="#FBFCFE" stroke="#E5E7EB" />
      ${shapes[params.variantIndex % shapes.length]}
      <rect x="72" y="72" width="92" height="10" rx="5" fill="${palette.a}" />
      <text x="72" y="122" font-family="Pretendard, sans-serif" font-size="22" font-weight="700" fill="${palette.a}">${PRESET_MAP[params.asset.channel].label}</text>
      <text x="72" y="190" font-family="Pretendard, sans-serif" font-size="48" font-weight="800" fill="${palette.c}">${title}</text>
      <foreignObject x="72" y="222" width="${preset.width - 144}" height="180">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Pretendard,sans-serif;font-size:24px;line-height:1.5;color:#4B5563;">
          ${summary}
        </div>
      </foreignObject>
      <rect x="72" y="${preset.height - 126}" width="280" height="56" rx="28" fill="${palette.a}" />
      <text x="106" y="${preset.height - 90}" font-family="Pretendard, sans-serif" font-size="24" font-weight="700" fill="#FFFFFF">${toSentence(params.asset.cta || "자세히 보기", 24)}</text>
      <text x="${preset.width - 220}" y="${preset.height - 84}" font-family="Pretendard, sans-serif" font-size="18" font-weight="700" fill="${palette.a}">${params.projectName}</text>
    </svg>
  `);
}

function buildSvgImageVariants(projectName: string, asset: AssetSeed, promptOverride?: string) {
  const preset = PRESET_MAP[asset.channel];
  const prompt = promptOverride?.trim() || buildImagePrompt(projectName, asset);

  return {
    prompt,
    preset,
    images: [0, 1, 2].map((variantIndex): ImageVariantRecord => ({
      role: `variant-${variantIndex + 1}`,
      originalPath: buildSvgVariant({
        projectName,
        asset,
        variantIndex,
      }),
      composedPath: buildSvgVariant({
        projectName,
        asset,
        variantIndex,
      }),
      width: preset.width,
      height: preset.height,
      selected: variantIndex === 0,
    })),
  };
}

async function generateOpenAiVariant(params: {
  prompt: string;
  channel: ImageChannel;
  role: string;
  selected: boolean;
  width: number;
  height: number;
}) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: params.prompt,
      size: toOpenAiSize(params.channel),
      quality: OPENAI_IMAGE_QUALITY,
      background: "opaque",
      output_format: "png",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI image request failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
  };

  const image = payload.data?.[0];
  const path = image?.b64_json
    ? `data:image/png;base64,${image.b64_json}`
    : image?.url;

  if (!path) {
    throw new Error("OpenAI image response did not include image data.");
  }

  return {
    role: params.role,
    originalPath: path,
    composedPath: path,
    width: params.width,
    height: params.height,
    selected: params.selected,
  } satisfies ImageVariantRecord;
}

async function buildOpenAiImageVariants(projectName: string, asset: AssetSeed, promptOverride?: string) {
  const preset = PRESET_MAP[asset.channel];
  const prompt = promptOverride?.trim() || buildImagePrompt(projectName, asset);

  const images = await Promise.all(
    VARIANT_DIRECTIONS.slice(0, OPENAI_VARIANT_COUNT).map((direction, index) =>
      generateOpenAiVariant({
        prompt: `${prompt} ${direction}. 텍스트는 이미지에 직접 넣지 말고, 배경 비주얼과 분위기만 만든다.`,
        channel: asset.channel,
        role: `variant-${index + 1}`,
        selected: index === 0,
        width: preset.width,
        height: preset.height,
      }),
    ),
  );

  return {
    prompt,
    preset,
    images,
  };
}

export async function buildImageVariants(projectName: string, asset: AssetSeed, promptOverride?: string) {
  if (!canUseOpenAiImage()) {
    return buildSvgImageVariants(projectName, asset, promptOverride);
  }

  try {
    return await buildOpenAiImageVariants(projectName, asset, promptOverride);
  } catch {
    return buildSvgImageVariants(projectName, asset, promptOverride);
  }
}
