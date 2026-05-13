function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asOptionalString(value: unknown) {
  const normalized = asString(value);
  return normalized.length > 0 ? normalized : undefined;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return fallback;
}

export class CmsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CmsValidationError";
  }
}

export async function parseSectionCreateInput(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const key = asString(body.key);
  const title = asString(body.title);

  if (!key) {
    throw new CmsValidationError("섹션 키는 필수입니다.");
  }

  if (!title) {
    throw new CmsValidationError("섹션 제목은 필수입니다.");
  }

  return {
    key,
    title,
    description: asOptionalString(body.description),
    visible: asBoolean(body.visible, true),
    sortOrder: asNumber(body.sortOrder, 0),
  };
}

export async function parseSectionUpdateInput(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const title = asString(body.title);

  if (!title) {
    throw new CmsValidationError("섹션 제목은 필수입니다.");
  }

  return {
    title,
    description: asOptionalString(body.description),
    visible: asBoolean(body.visible, true),
    sortOrder: asNumber(body.sortOrder, 0),
  };
}

function normalizeSlug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export async function parseItemCreateInput(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const title = asString(body.title);
  const summary = asString(body.summary);
  const slugInput = asString(body.slug);

  if (!title) {
    throw new CmsValidationError("항목 제목은 필수입니다.");
  }

  if (!summary) {
    throw new CmsValidationError("요약은 필수입니다.");
  }

  const slug = normalizeSlug(slugInput || title);

  if (!slug) {
    throw new CmsValidationError("슬러그를 생성할 수 없습니다.");
  }

  return {
    slug,
    title,
    subtitle: asOptionalString(body.subtitle),
    clientName: asOptionalString(body.clientName),
    periodLabel: asOptionalString(body.periodLabel),
    summary,
    body: asOptionalString(body.body),
    tags: asOptionalString(body.tags),
    imageUrl: asOptionalString(body.imageUrl),
    linkUrl: asOptionalString(body.linkUrl),
    status: asString(body.status, "published"),
    featured: asBoolean(body.featured, false),
    visible: asBoolean(body.visible, true),
    sortOrder: asNumber(body.sortOrder, 0),
  };
}

export async function parseItemUpdateInput(request: Request) {
  return parseItemCreateInput(request);
}
