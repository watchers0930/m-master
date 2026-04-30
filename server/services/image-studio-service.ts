type ImageChannel = "blog" | "instagram" | "facebook";

type AssetSeed = {
  channel: ImageChannel;
  title: string;
  body: string;
  cta: string;
};

const PRESET_MAP: Record<ImageChannel, { width: number; height: number; label: string }> = {
  blog: { width: 1200, height: 628, label: "Blog Hero" },
  instagram: { width: 1080, height: 1080, label: "Instagram Square" },
  facebook: { width: 1200, height: 630, label: "Facebook Link" },
};

function toSentence(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildImagePrompt(projectName: string, asset: AssetSeed) {
  const title = toSentence(asset.title, 90);
  const summary = toSentence(asset.body, 180);
  return `${projectName} ${asset.channel} 이미지. 제목은 "${title}", 핵심 메시지는 "${summary}", CTA는 "${toSentence(asset.cta, 80)}". 미니멀, 선명한 대비, 블루 포인트, 정보형 마케팅 비주얼.`;
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

export function buildImageVariants(projectName: string, asset: AssetSeed, promptOverride?: string) {
  const preset = PRESET_MAP[asset.channel];
  const prompt = promptOverride?.trim() || buildImagePrompt(projectName, asset);

  return {
    prompt,
    preset,
    images: [0, 1, 2].map((variantIndex) => ({
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
