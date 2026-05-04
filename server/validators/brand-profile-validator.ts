import { ProjectValidationError } from "./project-validator";

export type BrandProfileInput = {
  summary: string;
  audience?: string;
  tone?: string;
  cta?: string;
  bannedTerms?: string;
};

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

export async function parseBrandProfileInput(request: Request): Promise<BrandProfileInput> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ProjectValidationError("JSON 본문이 필요합니다.");
  }

  if (!body || typeof body !== "object") {
    throw new ProjectValidationError("컨텍스트 입력값이 올바르지 않습니다.");
  }

  const record = body as Record<string, unknown>;
  const summary = normalizeOptionalString(record.summary, 5000);

  if (!summary) {
    throw new ProjectValidationError("서비스 요약은 필수입니다.");
  }

  return {
    summary,
    audience: normalizeOptionalString(record.audience, 3000),
    tone: normalizeOptionalString(record.tone, 1000),
    cta: normalizeOptionalString(record.cta, 1000),
    bannedTerms: normalizeOptionalString(record.bannedTerms, 2000),
  };
}
