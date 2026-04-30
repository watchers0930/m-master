export type CreateProjectInput = {
  name: string;
  domain?: string;
  workingPath?: string;
  sourceFiles: SourceFileInput[];
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDomain(domain?: string): string | undefined {
  if (!domain) {
    return undefined;
  }

  const trimmed = domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

  if (!trimmed || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    throw new ProjectValidationError("유효한 도메인을 입력해야 합니다.");
  }

  return trimmed.toLowerCase();
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
    domain: normalizeDomain(normalizeOptionalString(inputRecord.domain)),
    workingPath,
    sourceFiles: parseSourceFiles(inputRecord.sourceFiles),
  };
}
