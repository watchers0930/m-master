import { normalizeTopicTitle } from "./topic-recommendation-service";

type BrandProfileSeed = {
  summary: string;
  audience: string | null;
  tone: string | null;
  cta: string | null;
};

type TopicSeed = {
  title: string;
  score: number | null;
};

type StudioChannel = "blog" | "instagram" | "facebook";

export type StudioSeedAsset = {
  channel: StudioChannel;
  title: string;
  body: string;
  cta: string;
};

export type StudioSeed = {
  topic: string;
  objective: string;
  assets: StudioSeedAsset[];
};

function toSentence(value: string | null | undefined, fallback: string, maxLength = 170): string {
  const normalized = (value || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength).trim();
}

function toKeywordLine(summary: string): string {
  const tokens = summary
    .replace(/[^a-zA-Z0-9가-힣\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const unique = [...new Set(tokens)].slice(0, 3);
  return unique.length > 0 ? unique.join(", ") : "핵심 기능, 활용 흐름, 실행 포인트";
}

function buildBlogBody(topic: string, profile: BrandProfileSeed): string {
  const summary = toSentence(profile.summary, "이 서비스의 핵심 가치를 짧고 명확하게 설명한다.");
  const audience = toSentence(profile.audience, "정보를 빠르게 파악하고 바로 실행으로 옮겨야 하는 실무 팀과 잠재 고객을 우선 대상으로 둔다.");
  const tone = toSentence(profile.tone, "과장 없이 핵심을 먼저 제시하고, 필요한 내용만 구조적으로 정리한다.");
  const cta = toSentence(profile.cta, "상세 내용 확인 또는 상담/문의 흐름으로 자연스럽게 연결한다.");

  return [
    `${topic}`,
    "",
    "왜 이 주제가 중요한가",
    summary,
    "",
    "이런 사람에게 먼저 필요하다",
    audience,
    "",
    "핵심 포인트",
    "- 서비스 맥락을 처음 접하는 사람도 빠르게 이해할 수 있게 정리한다.",
    "- 복잡한 기능보다 실제 활용 흐름과 바로 쓰는 포인트를 먼저 보여준다.",
    "- 읽은 뒤 다음 행동으로 바로 이어질 수 있게 CTA를 분명히 둔다.",
    "",
    "전달 방식",
    tone,
    "",
    "CTA",
    cta,
  ].join("\n");
}

function buildInstagramBody(topic: string, profile: BrandProfileSeed): string {
  const summary = toSentence(profile.summary, "서비스 핵심을 짧게 설명한다.", 110);
  const audience = toSentence(profile.audience, "실무 팀과 잠재 고객이 빠르게 핵심을 파악하도록 돕는다.", 100);
  const cta = toSentence(profile.cta, "저장하고 필요할 때 다시 확인하세요.", 100);

  return [
    `1장. ${topic}`,
    `2장. 왜 보아야 하나: ${summary}`,
    `3장. 이런 사람에게 필요: ${audience}`,
    "4장. 핵심 포인트: 복잡한 문서를 하나의 흐름으로 정리해 전달",
    `5장. 다음 행동: ${cta}`,
  ].join("\n");
}

function buildFacebookBody(topic: string, profile: BrandProfileSeed): string {
  const summary = toSentence(profile.summary, "서비스 핵심 가치를 한눈에 정리한다.", 140);
  const audience = toSentence(profile.audience, "실무 팀과 잠재 고객이 빠르게 이해할 수 있도록 돕는다.", 120);
  const cta = toSentence(profile.cta, "상세 내용을 확인하세요.", 110);

  return [
    `${topic}`,
    "",
    summary,
    "",
    `이런 분께 추천: ${audience}`,
    `핵심 키워드: ${toKeywordLine(summary)}`,
    "",
    cta,
  ].join("\n");
}

export function buildStudioSeed(params: {
  projectName: string;
  profile: BrandProfileSeed;
  topics: TopicSeed[];
}): StudioSeed {
  const selectedTopic = normalizeTopicTitle(
    [...params.topics].sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0]?.title ??
      `${params.projectName} 핵심 기능과 사용 흐름 한눈에 보기`,
    params.projectName,
  );

  return {
    topic: selectedTopic,
    objective: "블로그 원문을 기준으로 인스타그램과 페이스북 파생 초안을 각 채널 문법에 맞게 동시에 준비한다.",
    assets: [
      {
        channel: "blog",
        title: selectedTopic,
        body: buildBlogBody(selectedTopic, params.profile),
        cta: toSentence(params.profile.cta, "자세한 내용을 확인하세요.", 110),
      },
      {
        channel: "instagram",
        title: `${selectedTopic} 카드뉴스 초안`,
        body: buildInstagramBody(selectedTopic, params.profile),
        cta: "저장하고 필요할 때 다시 확인하세요.",
      },
      {
        channel: "facebook",
        title: `${selectedTopic} 링크 포스트 초안`,
        body: buildFacebookBody(selectedTopic, params.profile),
        cta: toSentence(params.profile.cta, "상세 내용을 확인하세요.", 110),
      },
    ],
  };
}
