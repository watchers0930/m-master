type FacebookPublishInput = {
  pageId: string;
  accessToken: string;
  message: string;
  link?: string | null;
};

type InstagramPublishInput = {
  instagramBusinessAccountId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
};

export class MetaPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaPublishError";
  }
}

function normalizeRemoteUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export async function publishToFacebookPage(input: FacebookPublishInput) {
  const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(input.pageId)}/feed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      message: input.message,
      link: input.link || "",
      access_token: input.accessToken,
    }).toString(),
  });

  const payload = (await response.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;

  if (!response.ok || !payload?.id) {
    throw new MetaPublishError(payload?.error?.message || "페이스북 게시 요청에 실패했습니다.");
  }

  return {
    id: payload.id,
    url: input.link || null,
  };
}

export async function publishToInstagram(input: InstagramPublishInput) {
  const imageUrl = normalizeRemoteUrl(input.imageUrl);

  if (!imageUrl) {
    throw new MetaPublishError("인스타그램 자동 게시에는 공개 가능한 원격 이미지 URL이 필요합니다.");
  }

  const createContainerResponse = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(input.instagramBusinessAccountId)}/media`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: input.caption,
        access_token: input.accessToken,
      }).toString(),
    },
  );

  const containerPayload = (await createContainerResponse.json().catch(() => null)) as
    | { id?: string; error?: { message?: string } }
    | null;

  if (!createContainerResponse.ok || !containerPayload?.id) {
    throw new MetaPublishError(containerPayload?.error?.message || "인스타그램 미디어 컨테이너 생성에 실패했습니다.");
  }

  const publishResponse = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(input.instagramBusinessAccountId)}/media_publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        creation_id: containerPayload.id,
        access_token: input.accessToken,
      }).toString(),
    },
  );

  const publishPayload = (await publishResponse.json().catch(() => null)) as
    | { id?: string; error?: { message?: string } }
    | null;

  if (!publishResponse.ok || !publishPayload?.id) {
    throw new MetaPublishError(publishPayload?.error?.message || "인스타그램 게시 실행에 실패했습니다.");
  }

  return {
    id: publishPayload.id,
    url: `https://www.instagram.com/p/${publishPayload.id}/`,
  };
}
