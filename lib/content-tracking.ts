export type TrackingChannel = "blog" | "instagram" | "facebook";

export type ContentTrackingPackage = {
  baseUrl: string | null;
  trackedUrl: string | null;
  campaign: string;
  source: string;
  medium: string;
  content: string;
  note?: string;
};

function slugify(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "campaign";
}

function normalizeBaseUrl(domain?: string | null) {
  const value = domain?.trim();
  if (!value) {
    return null;
  }

  try {
    return new URL(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`).toString();
  } catch {
    return null;
  }
}

function getChannelSource(channel: TrackingChannel) {
  if (channel === "blog") {
    return "blog";
  }

  return channel;
}

function getChannelMedium(channel: TrackingChannel) {
  if (channel === "blog") {
    return "owned-media";
  }

  return "social";
}

function createCampaignSlug(projectName: string, topic: string, contentJobId?: string) {
  const parts = [slugify(projectName), slugify(topic)];
  if (contentJobId) {
    parts.push(contentJobId.slice(0, 8));
  }

  return parts.filter(Boolean).join("-");
}

export function buildContentTrackingPackage(params: {
  domain?: string | null;
  projectName: string;
  topic: string;
  contentJobId?: string | null;
  channel: TrackingChannel;
}) : ContentTrackingPackage {
  const baseUrl = normalizeBaseUrl(params.domain);
  const source = getChannelSource(params.channel);
  const medium = getChannelMedium(params.channel);
  const campaign = createCampaignSlug(params.projectName, params.topic, params.contentJobId || undefined);
  const content = params.contentJobId
    ? `${params.channel}-${params.contentJobId.slice(0, 8)}`
    : `${params.channel}-draft`;

  if (!baseUrl) {
    return {
      baseUrl: null,
      trackedUrl: null,
      campaign,
      source,
      medium,
      content,
      note: "프로젝트 도메인이 없어 추적 링크를 만들지 못했습니다. 프로젝트 설정에 도메인을 넣으면 UTM 링크를 자동 생성합니다.",
    };
  }

  const url = new URL(baseUrl);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", campaign);
  url.searchParams.set("utm_content", content);

  return {
    baseUrl,
    trackedUrl: url.toString(),
    campaign,
    source,
    medium,
    content,
  };
}
