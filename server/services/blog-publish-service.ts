export type BlogPublishAsset = {
  title: string | null;
  body: string;
  cta: string | null;
  hashtags?: string | null;
  imageJobs: Array<{
    imageAssets: Array<{
      originalPath: string | null;
      composedPath: string | null;
      selected: boolean;
    }>;
  }>;
};

export type BlogPublishProject = {
  id: string;
  name: string;
  domain?: string | null;
};

export type BlogPublishProfile = {
  summary: string;
  cta?: string | null;
};

export type BlogPublishPackage = {
  platform: "blog";
  projectId: string;
  contentJobId: string;
  status: string;
  updatedAt: string;
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  bodyHtml: string;
  htmlWarnings: string[];
  cta?: string | null;
  hashtags?: string | null;
  coverImageUrl?: string | null;
  sourceUrl?: string | null;
};

function createSlug(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "project";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphizeMarkdown(value: string) {
  return value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function renderStructuredBlogBody(value: string) {
  const blocks: string[] = [];
  const lines = value.split("\n");
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push(`<p>${escapeHtml(paragraphLines.join(" ")).replace(/\n/g, "<br />")}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const imageCue = line.match(/^\[이미지\s+(\d+)\]\s+(.+)$/);

    if (imageCue) {
      flushParagraph();
      flushList();
      blocks.push(
        `<figure><figcaption>이미지 ${escapeHtml(imageCue[1])}. ${escapeHtml(imageCue[2])}</figcaption></figure>`,
      );
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`);
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("\n");
}

function parseHashtagText(value?: string | null) {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function createExportSlug(value: string) {
  return createSlug(value);
}

function sanitizeHtmlContent(value: string) {
  const warnings: string[] = [];
  let sanitized = value;

  const replacementRules: Array<{
    pattern: RegExp;
    warning: string;
  }> = [
    {
      pattern: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      warning: "script 태그를 제거했습니다.",
    },
    {
      pattern: /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
      warning: "iframe 태그를 제거했습니다.",
    },
    {
      pattern: /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
      warning: "object 태그를 제거했습니다.",
    },
    {
      pattern: /<embed\b[^>]*>/gi,
      warning: "embed 태그를 제거했습니다.",
    },
  ];

  replacementRules.forEach(({ pattern, warning }) => {
    if (pattern.test(sanitized)) {
      sanitized = sanitized.replace(pattern, "");
      warnings.push(warning);
    }
  });

  if (/\son[a-z]+\s*=\s*(['"]).*?\1/gi.test(sanitized) || /\son[a-z]+\s*=\s*[^\s>]+/gi.test(sanitized)) {
    sanitized = sanitized
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
      .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
    warnings.push("인라인 이벤트 속성을 제거했습니다.");
  }

  if (/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi.test(sanitized)) {
    sanitized = sanitized.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, " $1=\"#\"");
    warnings.push("javascript: 링크를 안전한 값으로 바꿨습니다.");
  }

  if (!sanitized.trim()) {
    sanitized = "<article><p>게시할 본문이 비어 있습니다.</p></article>";
    warnings.push("본문이 비어 있어 기본 안내 문구를 넣었습니다.");
  }

  return {
    bodyHtml: sanitized.trim(),
    htmlWarnings: warnings,
  };
}

export function buildBlogHtml(params: {
  title: string;
  body: string;
  cta?: string | null;
  hashtags?: string | null;
  coverImageUrl?: string | null;
}) {
  const bodyHtml = params.body.includes("## ") || /\[이미지\s+\d+\]/.test(params.body)
    ? renderStructuredBlogBody(params.body)
    : paragraphizeMarkdown(params.body);
  const ctaHtml = params.cta ? `<section><h2>다음 단계</h2><p>${escapeHtml(params.cta)}</p></section>` : "";
  const hashtagHtml = parseHashtagText(params.hashtags).length
    ? `<section><h2>해시태그</h2><p>${parseHashtagText(params.hashtags).map((tag) => escapeHtml(tag)).join(" ")}</p></section>`
    : "";
  const coverHtml = params.coverImageUrl
    ? `<figure><img src="${escapeHtml(params.coverImageUrl)}" alt="${escapeHtml(params.title)}" style="max-width:100%;height:auto;border-radius:16px;" /></figure>`
    : "";

  return [`<article>`, `<h1>${escapeHtml(params.title)}</h1>`, coverHtml, bodyHtml, ctaHtml, hashtagHtml, `</article>`]
    .filter(Boolean)
    .join("\n");
}

export function selectBlogCoverImage(asset: BlogPublishAsset) {
  const imageAssets = asset.imageJobs.flatMap((job) => job.imageAssets);

  return (
    imageAssets.find((imageAsset) => imageAsset.selected)?.composedPath ||
    imageAssets[0]?.composedPath ||
    imageAssets.find((imageAsset) => imageAsset.selected)?.originalPath ||
    imageAssets[0]?.originalPath ||
    null
  );
}

export function buildBlogPublishPackage(params: {
  project: BlogPublishProject;
  profile: BlogPublishProfile;
  asset: BlogPublishAsset;
  fallbackTitle: string;
  contentJobId: string;
  status: string;
  updatedAt: string;
  overrides?: {
    title?: string;
    slug?: string;
    summary?: string;
    bodyHtml?: string;
  };
}): BlogPublishPackage {
  const coverImageUrl = selectBlogCoverImage(params.asset);
  const title = params.overrides?.title?.trim() || params.asset.title || params.fallbackTitle;
  const summary = (params.overrides?.summary?.trim() || params.profile.summary).slice(0, 220);
  const cta = params.asset.cta || params.profile.cta || null;
  const hashtags = params.asset.hashtags?.trim() || null;
  const slug = params.overrides?.slug?.trim() || createSlug(title);
  const bodyMarkdown = [params.asset.body, "", "CTA", cta || "", "", "해시태그", hashtags || ""].filter(Boolean).join("\n");
  const rawBodyHtml =
    params.overrides?.bodyHtml?.trim() ||
    buildBlogHtml({
      title,
      body: params.asset.body,
      cta,
      hashtags,
      coverImageUrl,
    });
  const { bodyHtml, htmlWarnings } = sanitizeHtmlContent(rawBodyHtml);

  return {
    platform: "blog",
    projectId: params.project.id,
    contentJobId: params.contentJobId,
    status: params.status,
    updatedAt: params.updatedAt,
    slug,
    title,
    summary,
    bodyMarkdown,
    bodyHtml,
    htmlWarnings,
    cta,
    hashtags,
    coverImageUrl,
    sourceUrl: params.project.domain ?? null,
  };
}
