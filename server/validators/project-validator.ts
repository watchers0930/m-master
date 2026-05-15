export type CreateProjectInput = {
  name: string;
  domain?: string;
  industry?: string;
  workingPath?: string;
  sourceFiles: SourceFileInput[];
};

export type UpdateProjectSettingsInput = {
  industry?: string;
  ga4PropertyId?: string;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressAppPassword?: string;
  wordpressStatus?: "draft" | "publish";
  wordpressCategoryNames?: string;
  wordpressTagNames?: string;
  metaAccessToken?: string;
  metaTokenExpiresAt?: string;
  facebookPageId?: string;
  instagramBusinessAccountId?: string;
  operationsAlertWebhook?: string;
  alertPolicyMode?: "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review";
  alertQuietHoursStart?: string;
  alertQuietHoursEnd?: string;
  alertTimezone?: string;
  alertOnBlockedReadiness?: boolean;
  automationMode?: "draft-only" | "approved-auto-publish" | "full-auto";
  automationRequireReview?: boolean;
  automationMinOverallScore?: number;
  automationMinRiskScore?: number;
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

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return undefined;
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

function normalizeGa4PropertyId(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!/^\d{4,20}$/.test(normalized)) {
    throw new ProjectValidationError("GA4 속성 ID는 숫자만 입력해야 합니다.");
  }

  return normalized;
}

function normalizeAutomationMode(value: unknown): "draft-only" | "approved-auto-publish" | "full-auto" | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!["draft-only", "approved-auto-publish", "full-auto"].includes(normalized)) {
    throw new ProjectValidationError("자동화 모드 값이 올바르지 않습니다.");
  }

  return normalized as "draft-only" | "approved-auto-publish" | "full-auto";
}

function normalizeAlertPolicyMode(
  value: unknown,
): "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review" | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!["disabled", "all", "critical-only", "failures-only", "failures-and-review"].includes(normalized)) {
    throw new ProjectValidationError("알림 정책 값이 올바르지 않습니다.");
  }

  return normalized as "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review";
}

function normalizeClockValue(value: unknown, fieldLabel: string) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    throw new ProjectValidationError(`${fieldLabel}는 HH:MM 형식이어야 합니다.`);
  }

  const [hour, minute] = normalized.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new ProjectValidationError(`${fieldLabel} 값이 올바르지 않습니다.`);
  }

  return normalized;
}

function normalizeIsoDateTime(value: unknown, fieldLabel: string) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ProjectValidationError(`${fieldLabel} 값이 올바르지 않습니다.`);
  }

  return parsed.toISOString();
}

function normalizeAutomationScore(value: unknown, fieldLabel: string): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    throw new ProjectValidationError(`${fieldLabel}는 숫자로 입력해야 합니다.`);
  }

  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > 100) {
    throw new ProjectValidationError(`${fieldLabel}는 0부터 100 사이여야 합니다.`);
  }

  return rounded;
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

  if (wordpressStatus && wordpressStatus !== "draft" && wordpressStatus !== "publish") {
    throw new ProjectValidationError("워드프레스 게시 상태는 draft 또는 publish만 허용됩니다.");
  }

  if (industry && !ALLOWED_INDUSTRIES.has(industry)) {
    throw new ProjectValidationError("업종 분류 값이 올바르지 않습니다.");
  }

  return {
    industry,
    ga4PropertyId: normalizeGa4PropertyId(inputRecord.ga4PropertyId),
    wordpressSiteUrl: normalizeWebsiteTarget(normalizeOptionalString(inputRecord.wordpressSiteUrl)),
    wordpressUsername: normalizeOptionalString(inputRecord.wordpressUsername)?.slice(0, 120),
    wordpressAppPassword: normalizeOptionalString(inputRecord.wordpressAppPassword)?.slice(0, 300),
    wordpressStatus: wordpressStatus as "draft" | "publish" | undefined,
    wordpressCategoryNames: normalizeOptionalString(inputRecord.wordpressCategoryNames)?.slice(0, 300),
    wordpressTagNames: normalizeOptionalString(inputRecord.wordpressTagNames)?.slice(0, 300),
    metaAccessToken: normalizeOptionalString(inputRecord.metaAccessToken)?.slice(0, 600),
    metaTokenExpiresAt: normalizeIsoDateTime(inputRecord.metaTokenExpiresAt, "Meta 토큰 만료일"),
    facebookPageId: normalizeOptionalString(inputRecord.facebookPageId)?.slice(0, 120),
    instagramBusinessAccountId: normalizeOptionalString(inputRecord.instagramBusinessAccountId)?.slice(0, 120),
    operationsAlertWebhook: normalizeOptionalString(inputRecord.operationsAlertWebhook)?.slice(0, 600),
    alertPolicyMode: normalizeAlertPolicyMode(inputRecord.alertPolicyMode),
    alertQuietHoursStart: normalizeClockValue(inputRecord.alertQuietHoursStart, "조용한 시간 시작"),
    alertQuietHoursEnd: normalizeClockValue(inputRecord.alertQuietHoursEnd, "조용한 시간 종료"),
    alertTimezone: normalizeOptionalString(inputRecord.alertTimezone)?.slice(0, 80),
    alertOnBlockedReadiness: normalizeOptionalBoolean(inputRecord.alertOnBlockedReadiness),
    automationMode: normalizeAutomationMode(inputRecord.automationMode),
    automationRequireReview: normalizeOptionalBoolean(inputRecord.automationRequireReview),
    automationMinOverallScore: normalizeAutomationScore(inputRecord.automationMinOverallScore, "최소 종합 점수"),
    automationMinRiskScore: normalizeAutomationScore(inputRecord.automationMinRiskScore, "최소 리스크 점수"),
  };
}
