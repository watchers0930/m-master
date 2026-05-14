export type CreateProjectInput = {
  name: string;
  domain?: string;
  industry?: string;
  workingPath?: string;
  sourceFiles: SourceFileInput[];
};

export type UpdateProjectSettingsInput = {
  industry?: string;
  analyticsSourceType?: "ga4" | "external";
  analyticsSourceId?: string;
  analyticsSourceLabel?: string;
  analyticsEndpointUrl?: string;
  analyticsAccessKey?: string | null;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressStatus?: "draft" | "publish";
  wordpressCategoryNames?: string;
  wordpressTagNames?: string;
};

export type SourceFileInput = {
  name: string;
  relativePath?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  lastModified?: string;
  excerpt?: string;
};

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

const ALLOWED_INDUSTRIES = new Set(["general", "real-estate", "marketing", "saas", "finance"]);

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWebsiteTarget(domain?: string): string | undefined {
  if (!domain) {
    return undefined;
  }

  const trimmed = domain.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProjectValidationError("유효한 사이트 주소를 입력해야 합니다.");
  }

  if (!parsed.hostname || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(parsed.hostname)) {
    throw new ProjectValidationError("유효한 사이트 주소를 입력해야 합니다.");
  }

  const normalizedPath = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const path = normalizedPath && normalizedPath !== "/" ? normalizedPath : "";

  if (path) {
    return `${parsed.origin.toLowerCase()}${path}`;
  }

  return parsed.hostname.toLowerCase();
}

function parseSourceFiles(value: unknown): SourceFileInput[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ProjectValidationError("문서 목록 형식이 올바르지 않습니다.");
  }

  return value.slice(0, 50).map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ProjectValidationError(`문서 ${index + 1} 정보가 올바르지 않습니다.`);
    }

    const record = entry as Record<string, unknown>;
    const name = normalizeOptionalString(record.name);

    if (!name) {
      throw new ProjectValidationError(`문서 ${index + 1} 이름은 필수입니다.`);
    }

    const excerpt = normalizeOptionalString(record.excerpt);
    const relativePath = normalizeOptionalString(record.relativePath);
    const mimeType = normalizeOptionalString(record.mimeType);
    const extension = normalizeOptionalString(record.extension);
    const lastModified = normalizeOptionalString(record.lastModified);
    const size =
      typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
        ? Math.round(record.size)
        : undefined;

    if (excerpt && excerpt.length > 4000) {
      throw new ProjectValidationError(`문서 ${index + 1} excerpt는 4000자 이하여야 합니다.`);
    }

    return {
      name: name.slice(0, 180),
      relativePath: relativePath?.slice(0, 400),
      mimeType: mimeType?.slice(0, 120),
      extension: extension?.slice(0, 20),
      size,
      lastModified: lastModified?.slice(0, 64),
      excerpt: excerpt?.slice(0, 4000),
    };
  });
}

export async function parseCreateProjectInput(request: Request): Promise<CreateProjectInput> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ProjectValidationError("JSON 본문이 필요합니다.");
  }

  if (!body || typeof body !== "object") {
    throw new ProjectValidationError("프로젝트 생성 입력값이 올바르지 않습니다.");
  }

  const inputRecord = body as Record<string, unknown>;
  const name = normalizeOptionalString(inputRecord.name);

  if (!name) {
    throw new ProjectValidationError("프로젝트 이름은 필수입니다.");
  }

  if (name.length > 80) {
    throw new ProjectValidationError("프로젝트 이름은 80자 이하여야 합니다.");
  }

  const workingPath = normalizeOptionalString(inputRecord.workingPath);

  if (workingPath && workingPath.length > 500) {
    throw new ProjectValidationError("작업 폴더 경로는 500자 이하여야 합니다.");
  }

  return {
    name,
    domain: normalizeWebsiteTarget(normalizeOptionalString(inputRecord.domain)),
    industry: (() => {
      const industry = normalizeOptionalString(inputRecord.industry);
      if (!industry) {
        return undefined;
      }
      if (!ALLOWED_INDUSTRIES.has(industry)) {
        throw new ProjectValidationError("업종 분류 값이 올바르지 않습니다.");
      }
      return industry;
    })(),
    workingPath,
    sourceFiles: parseSourceFiles(inputRecord.sourceFiles),
  };
}

export async function parseUpdateProjectSettingsInput(request: Request): Promise<UpdateProjectSettingsInput> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ProjectValidationError("JSON 본문이 필요합니다.");
  }

  if (!body || typeof body !== "object") {
    throw new ProjectValidationError("프로젝트 설정 입력값이 올바르지 않습니다.");
  }

  const inputRecord = body as Record<string, unknown>;
  const wordpressStatus = normalizeOptionalString(inputRecord.wordpressStatus);
  const industry = normalizeOptionalString(inputRecord.industry);
  const analyticsSourceType = normalizeOptionalString(inputRecord.analyticsSourceType);
  const analyticsSourceId = normalizeOptionalString(inputRecord.analyticsSourceId);
  const analyticsSourceLabel = normalizeOptionalString(inputRecord.analyticsSourceLabel);
  const analyticsEndpointUrl = normalizeOptionalString(inputRecord.analyticsEndpointUrl);
  const analyticsAccessKey = normalizeOptionalString(inputRecord.analyticsAccessKey);

  if (wordpressStatus && wordpressStatus !== "draft" && wordpressStatus !== "publish") {
    throw new ProjectValidationError("워드프레스 게시 상태는 draft 또는 publish만 허용됩니다.");
  }

  if (industry && !ALLOWED_INDUSTRIES.has(industry)) {
    throw new ProjectValidationError("업종 분류 값이 올바르지 않습니다.");
  }

  if (analyticsSourceType && analyticsSourceType !== "ga4" && analyticsSourceType !== "external") {
    throw new ProjectValidationError("분석 소스 타입은 ga4 또는 external만 허용됩니다.");
  }

  if (analyticsSourceLabel && analyticsSourceLabel.length > 120) {
    throw new ProjectValidationError("분석 소스 이름은 120자 이하여야 합니다.");
  }

  if (analyticsSourceId && analyticsSourceId.length > 120) {
    throw new ProjectValidationError("분석 소스 ID는 120자 이하여야 합니다.");
  }

  return {
    industry,
    analyticsSourceType: analyticsSourceType as "ga4" | "external" | undefined,
    analyticsSourceId: analyticsSourceId?.slice(0, 120),
    analyticsSourceLabel: analyticsSourceLabel?.slice(0, 120),
    analyticsEndpointUrl: analyticsEndpointUrl ? normalizeWebsiteTarget(analyticsEndpointUrl) : undefined,
    analyticsAccessKey: analyticsAccessKey?.slice(0, 2000) || null,
    wordpressSiteUrl: normalizeWebsiteTarget(normalizeOptionalString(inputRecord.wordpressSiteUrl)),
    wordpressUsername: normalizeOptionalString(inputRecord.wordpressUsername)?.slice(0, 120),
    wordpressStatus: wordpressStatus as "draft" | "publish" | undefined,
    wordpressCategoryNames: normalizeOptionalString(inputRecord.wordpressCategoryNames)?.slice(0, 300),
    wordpressTagNames: normalizeOptionalString(inputRecord.wordpressTagNames)?.slice(0, 300),
  };
}
