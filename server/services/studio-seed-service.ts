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

function buildBlogBody(topic: string, profile: BrandProfileSeed): string {
  return [
    `${topic}`,
    "",
    `이 글은 ${profile.summary}`,
    "",
    `핵심 대상`,
    `${profile.audience ?? "핵심 타겟은 아직 확정되지 않았으며 승인 전 초안 상태다."}`,
    "",
    `전달 방식`,
    `${profile.tone ?? "과장 없는 설명형 톤으로 핵심부터 정리한다."}`,
    "",
    `마무리`,
    `${profile.cta ?? "다음 행동을 유도하는 CTA를 추가한다."}`,
  ].join("\n");
}

function buildInstagramBody(topic: string, profile: BrandProfileSeed): string {
  return [
    `1. ${topic}`,
    `2. 왜 중요한가: ${profile.summary}`,
    `3. 누구에게 필요한가: ${profile.audience ?? "핵심 타겟 승인 전 초안"}`,
    `4. 기억할 포인트: 과장 없이 핵심만 구조적으로 정리`,
    `5. 다음 행동: ${profile.cta ?? "다음 단계 확인"}`,
  ].join("\n");
}

function buildFacebookBody(topic: string, profile: BrandProfileSeed): string {
  return `${topic}\n\n${profile.summary}\n\n${profile.audience ?? ""}\n\n${profile.cta ?? "자세한 내용 확인"}`.trim();
}

export function buildStudioSeed(profile: BrandProfileSeed, topics: TopicSeed[]): StudioSeed {
  const selectedTopic =
    [...topics].sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0]?.title ??
    "브랜드 핵심 메시지 정리";

  return {
    topic: selectedTopic,
    objective: "블로그 원문을 기준으로 인스타그램과 페이스북 파생 초안을 동시에 준비한다.",
    assets: [
      {
        channel: "blog",
        title: selectedTopic,
        body: buildBlogBody(selectedTopic, profile),
        cta: profile.cta ?? "자세한 내용을 확인하세요.",
      },
      {
        channel: "instagram",
        title: `${selectedTopic} 카드뉴스 초안`,
        body: buildInstagramBody(selectedTopic, profile),
        cta: "저장하고 필요할 때 다시 확인하세요.",
      },
      {
        channel: "facebook",
        title: `${selectedTopic} 링크 포스트 초안`,
        body: buildFacebookBody(selectedTopic, profile),
        cta: profile.cta ?? "상세 내용을 확인하세요.",
      },
    ],
  };
}
