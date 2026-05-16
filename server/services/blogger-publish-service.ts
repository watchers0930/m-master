type BloggerPublishInput = {
  blogId: string;
  accessToken: string;
  title: string;
  content: string;
  status: "draft" | "publish";
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

export async function publishToBlogger(input: BloggerPublishInput): Promise<BloggerPublishResult> {
  const blogId = normalizeBlogId(input.blogId);
  const accessToken = normalizeAccessToken(input.accessToken);
  const labels = normalizeLabels(input.labels);
  const endpoint = new URL(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts`);

  if (input.status === "draft") {
    endpoint.searchParams.set("isDraft", "true");
  }

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: "blogger#post",
      title: input.title,
      content: input.content,
      labels: labels.length ? labels : undefined,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        id?: string;
        url?: string;
        selfLink?: string;
        status?: string;
        labels?: string[];
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok || !payload?.id) {
    throw new BloggerPublishError(payload?.error?.message || `Blogger 게시에 실패했습니다. HTTP ${response.status}`);
  }

  return {
    postId: payload.id,
    url: payload.url || payload.selfLink || "",
    status: input.status,
    selfLink: payload.selfLink || null,
    labels: payload.labels || labels,
  };
}
