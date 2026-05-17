type BloggerPublishInput = {
  blogId: string;
  accessToken: string;
  title: string;
  content: string;
  status: "draft" | "publish";
  postId?: string | null;
  labels?: string[] | null;
};

export type BloggerPublishResult = {
  postId: string;
  url: string;
  status: "draft" | "publish";
  selfLink?: string | null;
  labels?: string[];
};

export class BloggerPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BloggerPublishError";
  }
}

function normalizeBlogId(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new BloggerPublishError("Blogger 블로그 ID를 입력해야 합니다.");
  }

  return normalized;
}

function normalizeAccessToken(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new BloggerPublishError("Blogger OAuth access token을 입력해야 합니다.");
  }

  return normalized;
}

function normalizeLabels(value?: string[] | null) {
  if (!value?.length) {
    return [];
  }

  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

type BloggerApiPostPayload = {
  id?: string;
  url?: string;
  selfLink?: string;
  status?: string;
  labels?: string[];
  error?: {
    message?: string;
    errors?: Array<{
      message?: string;
      reason?: string;
    }>;
  };
};

async function readBloggerResponse(response: Response) {
  const text = await response.text();
  let payload: BloggerApiPostPayload | null = null;

  try {
    payload = text ? (JSON.parse(text) as BloggerApiPostPayload) : null;
  } catch {
    payload = null;
  }

  return { text, payload };
}

function formatBloggerError(
  label: string,
  response: Response,
  payload: BloggerApiPostPayload | null,
  text: string,
) {
  const reason = payload?.error?.errors?.map((item) => item.reason).filter(Boolean).join(", ");
  const message =
    payload?.error?.errors?.map((item) => item.message).filter(Boolean).join(" / ") ||
    payload?.error?.message ||
    text.trim();

  return new BloggerPublishError(
    `${label} 실패 (HTTP ${response.status})${reason ? ` · ${reason}` : ""}${message ? ` · ${message}` : ""}`.slice(0, 500),
  );
}

export async function publishToBlogger(input: BloggerPublishInput): Promise<BloggerPublishResult> {
  const blogId = normalizeBlogId(input.blogId);
  const accessToken = normalizeAccessToken(input.accessToken);
  const labels = normalizeLabels(input.labels);
  const normalizedPostId = input.postId?.trim() || null;
  const endpoint = normalizedPostId
    ? new URL(
        `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(normalizedPostId)}`,
      )
    : new URL(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts`);

  if (!normalizedPostId && input.status === "draft") {
    endpoint.searchParams.set("isDraft", "true");
  }

  const response = await fetch(endpoint.toString(), {
    method: normalizedPostId ? "PUT" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: "blogger#post",
      id: normalizedPostId || undefined,
      title: input.title,
      content: input.content,
      labels: labels.length ? labels : undefined,
    }),
  });

  const { text, payload } = await readBloggerResponse(response);

  if (!response.ok || !payload?.id) {
    throw formatBloggerError(normalizedPostId ? "Blogger 글 업데이트" : "Blogger 글 생성", response, payload, text);
  }

  let finalPayload = payload;

  if (normalizedPostId && input.status === "publish" && !payload.url) {
    const publishEndpoint = new URL(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(payload.id)}/publish`,
    );
    const publishResponse = await fetch(publishEndpoint.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const { text: publishText, payload: publishPayload } = await readBloggerResponse(publishResponse);

    if (!publishResponse.ok || !publishPayload?.id) {
      throw formatBloggerError("Blogger 공개 전환", publishResponse, publishPayload, publishText);
    }

    finalPayload = publishPayload;
  }

  return {
    postId: finalPayload.id || payload.id,
    url: finalPayload.url || finalPayload.selfLink || payload.url || payload.selfLink || "",
    status: input.status,
    selfLink: finalPayload.selfLink || payload.selfLink || null,
    labels: finalPayload.labels || payload.labels || labels,
  };
}
