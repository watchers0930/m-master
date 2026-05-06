import { ProjectValidationError } from "./project-validator";

export type ContentAssetInput = {
  channel: "blog" | "instagram" | "facebook";
  title?: string;
  body: string;
  cta?: string;
  hashtags?: string;
};

export type ContentJobInput = {
  topic?: string;
  topicId?: string;
  objective?: string;
  assets?: ContentAssetInput[];
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

function parseAssets(value: unknown): ContentAssetInput[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new ProjectValidationError("콘텐츠 자산 형식이 올바르지 않습니다.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ProjectValidationError(`콘텐츠 자산 ${index + 1} 형식이 올바르지 않습니다.`);
    }

    const record = entry as Record<string, unknown>;
    const channel = record.channel;
    if (channel !== "blog" && channel !== "instagram" && channel !== "facebook") {
      throw new ProjectValidationError(`콘텐츠 자산 ${index + 1} 채널이 올바르지 않습니다.`);
    }

    const body = normalizeOptionalString(record.body, 10000);
    if (!body) {
      throw new ProjectValidationError(`콘텐츠 자산 ${index + 1} 본문은 필수입니다.`);
    }

    return {
      channel,
      title: normalizeOptionalString(record.title, 300),
      body,
      cta: normalizeOptionalString(record.cta, 1000),
      hashtags: normalizeOptionalString(record.hashtags, 1000),
    };
  });
}

export async function parseContentJobInput(request: Request): Promise<ContentJobInput> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ProjectValidationError("JSON 본문이 필요합니다.");
  }

  if (!body || typeof body !== "object") {
    throw new ProjectValidationError("콘텐츠 입력값이 올바르지 않습니다.");
  }

  const record = body as Record<string, unknown>;
  const topic = normalizeOptionalString(record.topic, 300);
  const topicId = normalizeOptionalString(record.topicId, 80);

  if (!topic && !topicId) {
    throw new ProjectValidationError("주제 또는 topicId는 필수입니다.");
  }

  return {
    topic,
    topicId,
    objective: normalizeOptionalString(record.objective, 1000),
    assets: parseAssets(record.assets),
  };
}
