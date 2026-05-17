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
  };
};

async function parseBloggerPayload(response: Response) {
  return (await response.json().catch(() => null)) as BloggerApiPostPayload | null;
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

  const payload = await parseBloggerPayload(response);

  if (!response.ok || !payload?.id) {
    throw new BloggerPublishError(payload?.error?.message || `Blogger 게시에 실패했습니다. HTTP ${response.status}`);
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
    const publishPayload = await parseBloggerPayload(publishResponse);

    if (!publishResponse.ok || !publishPayload?.id) {
      throw new BloggerPublishError(
        publishPayload?.error?.message || `Blogger 게시 공개 전환에 실패했습니다. HTTP ${publishResponse.status}`,
      );
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
