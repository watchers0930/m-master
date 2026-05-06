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

const NAVER_BLOG_GUIDE = {
  minChars: 1000,
  targetChars: 1600,
  maxChars: 2400,
  recommendedImageCuesMin: 4,
  recommendedImageCuesMax: 7,
} as const;

const HASHTAG_STOPWORDS = new Set([
  "그리고",
  "관련",
  "중심",
  "기준",
  "통해",
  "먼저",
  "바로",
  "실제",
  "사용자",
  "서비스",
  "프로젝트",
  "콘텐츠",
  "마케팅",
  "블로그",
  "인스타그램",
  "페이스북",
  "기능과",
  "사용",
  "흐름",
  "한눈에",
  "보기",
  "한눈",
  "도입",
  "체크리스트",
  "문제와",
  "장면",
  "핵심",
  "가이드",
  "app",
  "vercel",
  "www",
  "http",
  "https",
  "html",
  "platform",
]);

const KOREAN_HASHTAG_SUFFIXES = ["입니다", "하다", "되는", "하는", "에서", "으로", "에게", "까지", "처럼", "보다", "라는", "리는", "은", "는", "이", "가", "을", "를", "에", "의", "와", "과", "로", "도", "다"];

const INDUSTRY_HASHTAG_GROUPS: Array<{
  name: string;
  keywords: string[];
  hashtags: string[];
}> = [
  {
    name: "real-estate",
    keywords: ["부동산", "전세", "매매", "임대", "자산관리", "분양", "청약", "매물"],
    hashtags: ["부동산", "자산관리", "부동산분석", "부동산투자"],
  },
  {
    name: "marketing",
    keywords: ["마케팅", "브랜드", "콘텐츠", "리드", "캠페인", "광고", "전환"],
    hashtags: ["콘텐츠마케팅", "브랜드마케팅", "마케팅전략", "리드전환"],
  },
  {
    name: "saas",
    keywords: ["saas", "플랫폼", "솔루션", "대시보드", "워크플로우", "자동화", "운영"],
    hashtags: ["saas", "업무자동화", "운영효율", "플랫폼전략"],
  },
  {
    name: "finance",
    keywords: ["금융", "투자", "자산", "수익", "리스크", "재무", "포트폴리오"],
    hashtags: ["금융인사이트", "투자분석", "포트폴리오", "리스크관리"],
  },
];

export type StudioSeedAsset = {
  channel: StudioChannel;
  title: string;
  body: string;
  cta: string;
  hashtags: string;
};

export type StudioSeed = {
  topic: string;
  objective: string;
  assets: StudioSeedAsset[];
};

function toSentence(value: string | null | undefined, fallback: string, maxLength = 140): string {
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

function clampText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function createImageCue(index: number, description: string) {
  return `[이미지 ${index}] ${description}`;
}

function normalizeHashtagBase(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripUrlArtifacts(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+){1,}\b/gi, " ");
}

function shouldKeepHashtagToken(token: string) {
  if (token.length < 2) {
    return false;
  }

  if (HASHTAG_STOPWORDS.has(token)) {
    return false;
  }

  if (/^\d+$/.test(token)) {
    return false;
  }

  return true;
}

function stripKoreanHashtagSuffix(token: string) {
  let next = token;

  for (const suffix of KOREAN_HASHTAG_SUFFIXES) {
    if (next.length - suffix.length < 2) {
      continue;
    }

    if (next.endsWith(suffix)) {
      next = next.slice(0, -suffix.length);
      break;
    }
  }

  return next;
}

function splitHashtagTokens(value: string) {
  return normalizeHashtagBase(stripUrlArtifacts(value))
    .split(" ")
    .map((token) => stripKoreanHashtagSuffix(token.trim()))
    .filter(shouldKeepHashtagToken);
}

function toHashtagCandidates(value: string) {
  const normalized = normalizeHashtagBase(value);
  const compact = normalized.replace(/\s/g, "");
  const tokens = splitHashtagTokens(value);
  const pairPhrases = tokens
    .slice(0, 4)
    .flatMap((token, index) => {
      const next = tokens[index + 1];
      return next ? [`${token}${next}`] : [];
    })
    .filter(shouldKeepHashtagToken);

  return [compact, ...pairPhrases, ...tokens].filter(shouldKeepHashtagToken);
}

function isHighValueStandaloneToken(token: string) {
  if (!shouldKeepHashtagToken(token)) {
    return false;
  }

  if (/^[a-z0-9]+$/.test(token)) {
    return token.length >= 4;
  }

  return token.length >= 3;
}

function rankHashtagCandidates(params: {
  topic: string;
  projectName: string;
  summary: string;
  channel: StudioChannel;
  industry?: string | null;
}) {
  const topicTokens = splitHashtagTokens(params.topic);
  const brandTokens = splitHashtagTokens(params.projectName);
  const summaryTokens = splitHashtagTokens(params.summary);
  const primaryBrand = brandTokens[0] || normalizeHashtagBase(params.projectName).replace(/\s/g, "");
  const scored = new Map<string, number>();

  const push = (token: string, score: number) => {
    if (!shouldKeepHashtagToken(token)) {
      return;
    }

    scored.set(token, Math.max(scored.get(token) ?? 0, score));
  };

  push(normalizeHashtagBase(params.topic).replace(/\s/g, ""), 100);
  push(normalizeHashtagBase(params.projectName).replace(/\s/g, ""), 95);

  topicTokens.slice(0, 3).forEach((token, index) => {
    if (token === primaryBrand) {
      return;
    }

    push(`${primaryBrand}${token}`, 88 - index);
  });

  topicTokens
    .slice(0, 4)
    .flatMap((token, index) => {
      const next = topicTokens[index + 1];
      return next ? [`${token}${next}`] : [];
    })
    .forEach((token, index) => push(token, 80 - index));

  brandTokens.forEach((token, index) => push(token, 72 - index));
  topicTokens.filter(isHighValueStandaloneToken).forEach((token, index) => push(token, 66 - index));
  summaryTokens.filter(isHighValueStandaloneToken).slice(0, 3).forEach((token, index) => push(token, 54 - index));

  push(params.channel === "blog" ? "네이버마케팅" : "소셜콘텐츠", 40);
  push(params.channel === "blog" ? "블로그운영" : "콘텐츠기획", 38);

  const industryContext = `${params.topic} ${params.projectName} ${params.summary}`.toLowerCase();
  for (const group of INDUSTRY_HASHTAG_GROUPS) {
    if (params.industry === group.name) {
      group.hashtags.forEach((tag, index) => push(tag, 76 - index));
      continue;
    }

    const matchedCount = group.keywords.filter((keyword) => industryContext.includes(keyword.toLowerCase())).length;

    if (matchedCount === 0) {
      continue;
    }

    group.hashtags.forEach((tag, index) => push(tag, 64 + matchedCount * 3 - index));
  }

  return [...scored.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
    .map(([token]) => token)
    .slice(0, 6);
}

function buildSuggestedHashtags(
  topic: string,
  projectName: string,
  summary: string,
  channel: StudioChannel,
  industry?: string | null,
) {
  return rankHashtagCandidates({
    topic,
    projectName,
    summary,
    channel,
    industry,
  })
    .map((token) => `#${token}`)
    .join(", ");
}

function buildBlogChecklist(summary: string, audience: string, cta: string) {
  return [
    `- ${clampText(summary, 80)} 중심으로 독자가 처음 10초 안에 핵심을 이해하게 정리한다.`,
    `- ${clampText(audience, 76)} 입장에서 실제 활용 장면과 판단 기준이 보이도록 설명한다.`,
    "- 핵심 키워드는 제목, 도입부, 소제목에 자연스럽게 반복하고 억지로 남발하지 않는다.",
    `- ${clampText(cta, 72)}로 자연스럽게 이어지도록 마무리 동선을 분명히 둔다.`,
  ].join("\n");
}

function ensureBlogBodyLength(body: string, topic: string, summary: string, tone: string) {
  if (body.length >= NAVER_BLOG_GUIDE.minChars) {
    return body.slice(0, NAVER_BLOG_GUIDE.maxChars).trim();
  }

  const fillerSection = [
    "",
    "## 실무 체크포인트",
    `${topic} 관련 글은 기능 나열보다 실제 사용 흐름과 판단 포인트를 먼저 설명해야 이탈이 적다. ${clampText(summary, 140)} 또한 ${clampText(tone, 120)} 원칙을 유지하면 읽는 리듬이 무너지지 않는다.`,
    "독자는 한 번에 모든 정보를 외우려 하지 않는다. 그래서 각 문단은 하나의 질문에 답하는 방식으로 짧게 끊고, 이미지와 본문이 같은 메시지를 반복하도록 맞추는 편이 안정적이다.",
  ].join("\n");

  return `${body}\n${fillerSection}`.slice(0, NAVER_BLOG_GUIDE.maxChars).trim();
}

function buildBlogBody(topic: string, profile: BrandProfileSeed): string {
  const summary = toSentence(profile.summary, "이 서비스의 핵심 가치를 짧고 명확하게 설명한다.", 100);
  const audience = toSentence(profile.audience, "정보를 빠르게 파악하고 바로 실행으로 옮겨야 하는 실무 팀과 잠재 고객을 우선 대상으로 둔다.", 88);
  const tone = toSentence(profile.tone, "과장 없이 핵심을 먼저 제시하고, 필요한 내용만 구조적으로 정리한다.", 88);
  const cta = toSentence(profile.cta, "상세 내용 확인 또는 상담/문의 흐름으로 자연스럽게 연결한다.", 82);
  const keywordLine = toKeywordLine(summary);
  const body = [
    "## 도입",
    `${topic}를 처음 접한 사람은 보통 서비스 이름보다 지금 당장 무엇을 해결해 주는지부터 확인한다. 그래서 첫 문단에서는 복잡한 배경 설명보다 핵심 문제와 기대 효과를 먼저 짚는 편이 읽기 흐름에 맞다.`,
    `${summary} 이 글은 ${audience}를 기준으로, 기능 목록보다 실제 이해 순서에 맞춰 내용을 정리한다.`,
    "",
    createImageCue(1, "도입부에서 문제 상황이나 핵심 결과를 한눈에 보여주는 대표 이미지"),
    "",
    "## 1. 왜 이 주제가 중요한가",
    `독자가 검색을 통해 블로그 글에 들어오는 순간 가장 먼저 확인하는 것은 자신과 관련 있는 이야기인지 여부다. ${topic}가 중요한 이유를 초반에 분명히 제시하면 이후 문단의 설득력이 안정된다.`,
    `특히 ${clampText(audience, 120)} 같은 독자는 긴 배경 설명보다 바로 적용 가능한 맥락을 원한다. 따라서 문제 정의, 해결 방식, 기대되는 변화의 순서로 정보를 배치하는 것이 좋다.`,
    "",
    createImageCue(2, "핵심 문제 또는 현재 업무 흐름을 설명하는 캡처 이미지"),
    "",
    "## 2. 어떤 방식으로 이해시키면 좋은가",
    `${clampText(tone, 150)} 문장을 길게 늘이기보다 한 문단에 하나의 메시지만 남기고, 문단 사이에 이미지를 배치해 리듬을 끊어 주는 편이 네이버 블로그 읽기 패턴에 맞다.`,
    "아래 기준으로 본문을 구성하면 초안 품질이 안정적이다.",
    buildBlogChecklist(summary, audience, cta),
    "",
    createImageCue(3, "핵심 기능 또는 사용 흐름을 설명하는 단계형 이미지"),
    "",
    "## 3. 본문에서 빠지면 안 되는 설명",
    `${topic}를 다룰 때는 단순히 좋다는 표현보다 무엇이 달라지는지 구체적으로 적어야 한다. 예를 들어 검색 유입 독자에게는 어떤 상황에서 필요한지, 실무 담당자에게는 어떤 판단을 빨리 도와주는지처럼 장면 중심으로 설명하는 편이 자연스럽다.`,
    `또한 키워드만 반복하기보다 ${keywordLine} 같은 핵심 표현을 문맥 안에서 다시 풀어 써야 글이 기계적으로 보이지 않는다. 이미지 역시 장식이 아니라 각 섹션의 메시지를 보강하는 역할을 맡아야 한다.`,
    "",
    createImageCue(4, "실제 적용 예시나 전후 비교를 보여주는 설명 이미지"),
    "",
    "## 자주 놓치는 포인트",
    "짧은 문장을 유지하더라도 정보가 빈약하면 글의 체류 시간이 떨어진다. 반대로 정보를 많이 넣더라도 문단이 길어지면 모바일에서 읽기 어렵다. 그래서 한 문단은 2~4문장 정도로 끊고, 각 섹션마다 독자가 얻는 답을 분명히 남기는 편이 좋다.",
    `이미지 수 역시 과도하게 많기보다 문맥상 필요한 위치에 배치하는 것이 중요하다. 이 초안은 본문 기준 ${NAVER_BLOG_GUIDE.recommendedImageCuesMin}장 이상 ${NAVER_BLOG_GUIDE.recommendedImageCuesMax}장 이하의 이미지 흐름을 권장 가이드로 둔다.`,
    "",
    createImageCue(5, "FAQ 또는 실무 팁 섹션을 보강하는 보조 이미지"),
    "",
    "## 마무리",
    `${topic} 관련 글은 독자가 다음 행동으로 이동할 수 있게 끝나야 한다. 핵심 요약을 다시 짚고, 더 자세한 확인이나 문의가 필요할 때 어디로 이어질지 명확하게 안내하면 블로그 본문의 완성도가 높아진다.`,
    `${cta}`,
  ].join("\n");

  return ensureBlogBodyLength(body, topic, summary, tone);
}

function buildInstagramBody(topic: string, profile: BrandProfileSeed): string {
  const summary = toSentence(profile.summary, "서비스 핵심을 짧게 설명한다.", 110);
  const audience = toSentence(profile.audience, "실무 팀과 잠재 고객이 빠르게 핵심을 파악하도록 돕는다.", 100);
  const cta = toSentence(profile.cta, "핵심 내용을 확인하고 자세한 정보를 이어서 살펴보세요.", 100);

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
  industry?: string | null;
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
    objective: "선택한 주제를 기준으로 서비스 설명의 핵심 맥락을 정리하고, 이를 채널별 형식에 맞는 초안으로 준비한다.",
    assets: [
      {
        channel: "blog",
        title: selectedTopic,
        body: buildBlogBody(selectedTopic, params.profile),
        cta: toSentence(params.profile.cta, "자세한 내용을 확인하세요.", 110),
        hashtags: buildSuggestedHashtags(selectedTopic, params.projectName, params.profile.summary, "blog", params.industry),
      },
      {
        channel: "instagram",
        title: `${selectedTopic} 인스타그램 초안`,
        body: buildInstagramBody(selectedTopic, params.profile),
        cta: toSentence(params.profile.cta, "핵심 내용을 확인하고 자세한 정보를 이어서 살펴보세요.", 100),
        hashtags: buildSuggestedHashtags(selectedTopic, params.projectName, params.profile.summary, "instagram", params.industry),
      },
      {
        channel: "facebook",
        title: `${selectedTopic} 페이스북 초안`,
        body: buildFacebookBody(selectedTopic, params.profile),
        cta: toSentence(params.profile.cta, "상세 내용을 확인하세요.", 110),
        hashtags: buildSuggestedHashtags(selectedTopic, params.projectName, params.profile.summary, "facebook", params.industry),
      },
    ],
  };
}
