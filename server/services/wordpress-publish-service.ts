type WordPressPublishInput = {
  siteUrl: string;
  username: string;
  appPassword: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  status: "draft" | "publish";
  coverImageUrl?: string | null;
  categoryNames?: string | null;
  tagNames?: string | null;
};

export class WordPressPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressPublishError";
  }
}

function normalizeWordPressBaseUrl(siteUrl: string) {
  const trimmed = siteUrl.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new WordPressPublishError("유효한 워드프레스 사이트 주소를 입력해야 합니다.");
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function buildAuthToken(username: string, appPassword: string) {
  return Buffer.from(`${username}:${appPassword}`).toString("base64");
}

function sanitizeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "upload";
}

function isUnsplashUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "images.unsplash.com" || url.hostname.endsWith(".unsplash.com");
  } catch {
    return false;
  }
}

function parseCommaSeparatedNames(value?: string | null) {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 10);
}

function decodeSvgDataUrl(dataUrl: string) {
  const matched = dataUrl.match(/^data:image\/svg\+xml;charset=utf-8,(.+)$/);

  if (!matched) {
    return null;
  }

  return decodeURIComponent(matched[1]);
}

function renderSvgToPngBuffer(svg: string) {
  // Load only at runtime so Turbopack does not try to place the native binding in client/edge chunks.
  const runtimeRequire = eval("require") as (id: string) => { Resvg: new (...args: unknown[]) => { render: () => { asPng: () => Uint8Array } } };
  const { Resvg } = runtimeRequire("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 1200,
    },
  });

  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}

async function resolveImageUploadSource(imageUrl: string, title: string) {
  if (imageUrl.startsWith("data:")) {
    if (imageUrl.startsWith("data:image/svg+xml")) {
      const svg = decodeSvgDataUrl(imageUrl);

      if (!svg) {
        return null;
      }

      return {
        mimeType: "image/png",
        buffer: renderSvgToPngBuffer(svg),
        filename: `${sanitizeFilename(title)}.png`,
      };
    }

    const matched = imageUrl.match(/^data:([^;]+);base64,(.+)$/);

    if (!matched) {
      return null;
    }

    const mimeType = matched[1];
    const base64 = matched[2];

    const extension =
      mimeType === "image/png"
        ? "png"
        : mimeType === "image/jpeg"
          ? "jpg"
          : mimeType === "image/webp"
            ? "webp"
            : null;

    if (!extension) {
      return null;
    }

    return {
      mimeType,
      buffer: Buffer.from(base64, "base64"),
      filename: `${sanitizeFilename(title)}.${extension}`,
    };
  }

  const response = await fetch(imageUrl);

  if (!response.ok) {
    return null;
  }

  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const extension =
    mimeType.includes("png")
      ? "png"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
        ? "jpg"
        : mimeType.includes("webp")
          ? "webp"
          : null;

  if (!extension) {
    return null;
  }

  return {
    mimeType,
    buffer: Buffer.from(await response.arrayBuffer()),
    filename: `${sanitizeFilename(title)}.${extension}`,
  };
}

async function uploadFeaturedMedia(params: {
  baseUrl: string;
  authToken: string;
  title: string;
  coverImageUrl: string;
}) {
  if (isUnsplashUrl(params.coverImageUrl)) {
    return {
      mediaId: null,
      warning: "Unsplash 이미지는 핫링크 정책을 유지하기 위해 워드프레스 featured image 업로드를 건너뛰었습니다.",
    };
  }

  const source = await resolveImageUploadSource(params.coverImageUrl, params.title);

  if (!source) {
    return {
      mediaId: null,
      warning: "대표 이미지를 업로드할 수 없는 형식이어서 featured image 연결을 건너뛰었습니다.",
    };
  }

  const response = await fetch(`${params.baseUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${params.authToken}`,
      "Content-Type": source.mimeType,
      "Content-Disposition": `attachment; filename="${source.filename}"`,
    },
    body: source.buffer,
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        id?: number;
        message?: string;
      }
    | null;

  if (!response.ok || !payload?.id) {
    return {
      mediaId: null,
      warning: payload?.message || "워드프레스 media 업로드에 실패해 featured image 연결을 건너뛰었습니다.",
    };
  }

  return {
    mediaId: payload.id,
    warning: null,
  };
}

async function findOrCreateTerm(params: {
  baseUrl: string;
  authToken: string;
  taxonomy: "categories" | "tags";
  name: string;
}) {
  const queryUrl = `${params.baseUrl}/wp-json/wp/v2/${params.taxonomy}?search=${encodeURIComponent(params.name)}&per_page=100`;
  const queryResponse = await fetch(queryUrl, {
    headers: {
      Authorization: `Basic ${params.authToken}`,
    },
  });

  if (queryResponse.ok) {
    const existingTerms = (await queryResponse.json().catch(() => [])) as Array<{ id?: number; name?: string }>;
    const exact = existingTerms.find((term) => term.name?.trim().toLowerCase() === params.name.toLowerCase());

    if (exact?.id) {
      return exact.id;
    }
  }

  const createResponse = await fetch(`${params.baseUrl}/wp-json/wp/v2/${params.taxonomy}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${params.authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: params.name,
    }),
  });

  const created = (await createResponse.json().catch(() => null)) as
    | {
        id?: number;
        message?: string;
        data?: { term_id?: number };
      }
    | null;

  if (!createResponse.ok || !created?.id) {
    throw new WordPressPublishError(
      created?.message || `${params.taxonomy === "categories" ? "카테고리" : "태그"} 생성에 실패했습니다: ${params.name}`,
    );
  }

  return created.id;
}

async function resolveTermIds(params: {
  baseUrl: string;
  authToken: string;
  taxonomy: "categories" | "tags";
  names: string[];
}) {
  if (params.names.length === 0) {
    return [];
  }

  return Promise.all(
    params.names.map((name) =>
      findOrCreateTerm({
        baseUrl: params.baseUrl,
        authToken: params.authToken,
        taxonomy: params.taxonomy,
        name,
      }),
    ),
  );
}

export async function publishToWordPress(input: WordPressPublishInput) {
  const baseUrl = normalizeWordPressBaseUrl(input.siteUrl);
  const endpoint = `${baseUrl}/wp-json/wp/v2/posts`;
  const authToken = buildAuthToken(input.username, input.appPassword);
  const categoryIds = await resolveTermIds({
    baseUrl,
    authToken,
    taxonomy: "categories",
    names: parseCommaSeparatedNames(input.categoryNames),
  });
  const tagIds = await resolveTermIds({
    baseUrl,
    authToken,
    taxonomy: "tags",
    names: parseCommaSeparatedNames(input.tagNames),
  });
  const mediaUpload = input.coverImageUrl
    ? await uploadFeaturedMedia({ baseUrl, authToken, title: input.title, coverImageUrl: input.coverImageUrl })
    : { mediaId: null, warning: null };
  const featuredMediaId = mediaUpload.mediaId;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      status: input.status,
      excerpt: input.excerpt,
      content: input.content,
      featured_media: featuredMediaId ?? undefined,
      categories: categoryIds,
      tags: tagIds,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        id?: number;
        link?: string;
        status?: string;
        message?: string;
        code?: string;
      }
    | null;

  if (!response.ok || !payload?.id) {
    throw new WordPressPublishError(payload?.message || "워드프레스 게시 요청에 실패했습니다.");
  }

  return {
    postId: payload.id,
    link: payload.link || "",
    status: payload.status || input.status,
    featuredMediaId,
    mediaWarning: mediaUpload.warning,
    categoryIds,
    tagIds,
  };
}
