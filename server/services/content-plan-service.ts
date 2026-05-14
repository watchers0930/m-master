import type { Ga4OverviewResponse } from "@/lib/ga4";

type TopicSeed = {
  title: string;
  intentType?: string;
  score?: number;
  rationale?: string;
};

export type PlannedContentItem = {
  sortOrder: number;
  weekLabel: string;
  topic: string;
  intentType?: string;
  objective: string;
  rationale: string;
  status?: string;
};

export type MonthlyContentPlan = {
  monthKey: string;
  basisSummary: string;
  items: PlannedContentItem[];
};

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function pickFocusPages(overview: Ga4OverviewResponse) {
  return uniqueStrings(
    overview.topPages
      .slice(0, 4)
      .map((item) => item.path)
      .filter((path) => path && path !== "/"),
  );
}

function pickChannelSignals(overview: Ga4OverviewResponse) {
  return uniqueStrings(overview.topChannels.slice(0, 3).map((item) => item.label));
}

function createBasisSummary(params: {
  overview: Ga4OverviewResponse;
  projectName: string;
  focusPages: string[];
  channels: string[];
}) {
  const topPageHint = params.focusPages.length > 0
    ? `상위 유입 페이지는 ${params.focusPages.join(", ")} 입니다.`
    : "상위 유입 페이지는 홈과 핵심 랜딩 중심입니다.";
  const channelHint = params.channels.length > 0
    ? `주요 유입 채널은 ${params.channels.join(", ")} 입니다.`
    : "직접 유입 비중이 높아 검색형 주제 보강이 필요합니다.";

  return `${params.projectName}의 최근 ${params.overview.rangeDays}일 데이터 기준 총 ${params.overview.overview.sessions}세션, ${params.overview.overview.views}페이지뷰가 확인되었습니다. ${topPageHint} ${channelHint}`;
}

function deriveObjective(intentType: string | undefined, cta: string | null | undefined) {
  if (intentType === "conversion") {
    return cta?.trim() || "상담/문의 전환으로 이어지는 판단 기준을 제시한다.";
  }

  if (intentType === "branding") {
    return "브랜드가 해결하는 문제와 적용 장면을 신뢰감 있게 설명한다.";
  }

  return "검색 유입을 늘릴 수 있는 실무형 답변 콘텐츠를 만든다.";
}

function deriveRationale(params: {
  intentType?: string;
  pathHint?: string;
  channelHint?: string;
  topic: string;
  fallbackRationale?: string;
}) {
  const channelText = params.channelHint ? `${params.channelHint} 유입이 보이는 상황에서` : "현재 유입 구조를 보면";
  const pageText = params.pathHint ? `${params.pathHint} 경로와 연결되는 설명이 필요합니다.` : "홈/핵심 랜딩으로 이어지는 설명이 필요합니다.";

  if (params.fallbackRationale) {
    return `${channelText} ${params.fallbackRationale} ${pageText}`.trim();
  }

  if (params.intentType === "conversion") {
    return `${channelText} ${params.topic} 주제는 전환 전 마지막 판단 포인트를 정리하는 데 적합합니다. ${pageText}`.trim();
  }

  if (params.intentType === "branding") {
    return `${channelText} ${params.topic} 주제는 브랜드 맥락을 깊게 설명해 체류 시간을 늘리기 좋습니다. ${pageText}`.trim();
  }

  return `${channelText} ${params.topic} 주제는 검색형 질문에 답하면서 신규 유입을 넓히기 좋습니다. ${pageText}`.trim();
}

function withPageAngle(topic: string, pathHint?: string) {
  if (!pathHint || pathHint === "/") {
    return topic;
  }

  const normalized = pathHint.replace(/\//g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return topic;
  }

  return `${topic} | ${normalized} 연결 가이드`;
}

export function buildMonthlyContentPlan(params: {
  monthKey: string;
  projectName: string;
  industry: string;
  brandSummary: string;
  cta?: string | null;
  analyticsOverview: Ga4OverviewResponse;
  topics: TopicSeed[];
}): MonthlyContentPlan {
  const focusPages = pickFocusPages(params.analyticsOverview);
  const channels = pickChannelSignals(params.analyticsOverview);
  const basisSummary = createBasisSummary({
    overview: params.analyticsOverview,
    projectName: params.projectName,
    focusPages,
    channels,
  });

  const prioritizedTopics = params.topics.slice(0, 4);
  const weekLabels = ["1주차", "2주차", "3주차", "4주차"];

  const items = weekLabels.map((weekLabel, index) => {
    const seed = prioritizedTopics[index] || prioritizedTopics[index % Math.max(prioritizedTopics.length, 1)] || {
      title: `${params.projectName} 핵심 활용 가이드`,
      intentType: "search",
      score: 7,
      rationale: `${params.projectName}의 핵심 설명 자산을 만드는 기본 주제입니다.`,
    };
    const pathHint = focusPages[index % Math.max(focusPages.length, 1)];
    const channelHint = channels[index % Math.max(channels.length, 1)];
    const topic = withPageAngle(seed.title, pathHint);

    return {
      sortOrder: index + 1,
      weekLabel,
      topic,
      intentType: seed.intentType || "search",
      objective: deriveObjective(seed.intentType, params.cta),
      rationale: deriveRationale({
        intentType: seed.intentType,
        pathHint,
        channelHint,
        topic,
        fallbackRationale: seed.rationale,
      }),
      status: "planned",
    };
  });

  return {
    monthKey: params.monthKey,
    basisSummary,
    items,
  };
}
