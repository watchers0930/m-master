import { ProjectValidationError } from "./project-validator";

export type ContentPlanRequestInput = {
  monthKey?: string;
};

function normalizeMonthKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new ProjectValidationError("monthKey는 YYYY-MM 형식이어야 합니다.");
  }

  const month = Number(normalized.slice(5, 7));

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ProjectValidationError("monthKey는 YYYY-MM 형식이어야 합니다.");
  }

  return normalized;
}

export function parseContentPlanQuery(request: Request): ContentPlanRequestInput {
  const { searchParams } = new URL(request.url);
  return {
    monthKey: normalizeMonthKey(searchParams.get("monthKey")),
  };
}

export async function parseContentPlanInput(request: Request): Promise<ContentPlanRequestInput> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {};
  }

  if (!body || typeof body !== "object") {
    throw new ProjectValidationError("월간 계획 입력값이 올바르지 않습니다.");
  }

  const record = body as Record<string, unknown>;

  return {
    monthKey: normalizeMonthKey(record.monthKey),
  };
}
