type PlanningProject = {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  ga4PropertyId?: string | null;
};

type PlanningBrandProfile = {
  summary: string;
  audience?: string | null;
  tone?: string | null;
  cta?: string | null;
  bannedTerms?: string | null;
};

type PlanningTopic = {
  title: string;
  intentType?: string | null;
  score?: number | null;
  rationale?: string | null;
};

type PlanningSnapshot = {
  configured: boolean;
  error: string | null;
  metricCards: Array<{ label: string; value: string; delta: string }>;
  trafficSources: Array<{ label: string; value: string }>;
  topPages: Array<{ path: string; title: string; views: number; stay: string; bounce: string }>;
  sourcePaths: Array<{ source: string; medium: string; sessions: number; ratio: string }>;
};

type PlanningPerformanceFeedback = {
  publishedJobs: number;
  failedPublications: number;
  successfulPublications: number;
  channelMix: Array<{ channel: string; count: number }>;
  recentPublishedTopics: string[];
};

export type GeneratedContentPlan = {
  monthKey: string;
  status: "draft";
  basisSummary: string;
  autoGenerate: boolean;
  generatedAt: Date;
  items: Array<{
    sortOrder: number;
    weekLabel: string;
    publishAt: Date;
    topic: string;
    intentType?: string;
    objective: string;
    rationale: string;
    status: "planned";
    generatedAt: Date;
  }>;
};

const MONTH_FOCUS: Record<number, { label: string; angles: string[] }> = {
  1: { label: "신년 전환", angles: ["체크리스트", "실행 계획", "도입 우선순위"] },
  2: { label: "짧은 달 집중", angles: ["빠른 성과", "필수 점검", "압축 실행"] },
  3: { label: "분기 준비", angles: ["재정비", "리드 확보", "운영 체계"] },
  4: { label: "실행 가속", angles: ["실무 적용", "캠페인 준비", "전환 개선"] },
  5: { label: "확장 시점", angles: ["브랜드 확장", "채널 최적화", "사례 정리"] },
  6: { label: "상반기 점검", angles: ["중간 결산", "성과 분석", "하반기 준비"] },
  7: { label: "여름 관심도", angles: ["시즌 이슈", "가벼운 진입", "문제 예방"] },
  8: { label: "하반기 준비", angles: ["재시동", "업무 복귀", "효율 개선"] },
  9: { label: "예산/전략 시즌", angles: ["계획 수립", "성과 비교", "전략 업데이트"] },
  10: { label: "피크 운영", angles: ["캠페인 확대", "전환 강화", "반복 확산"] },
  11: { label: "마감 압박", angles: ["실적 점검", "리드 회수", "우선순위 재조정"] },
  12: { label: "연말 정리", angles: ["회고", "다음 해 준비", "사례 자산화"] },
};

function parseMonthKey(monthKey?: string) {
  const fallback = new Date().toISOString().slice(0, 7);
  const normalized = (monthKey || fallback).trim();

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error("monthKey는 YYYY-MM 형식이어야 합니다.");
  }

  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(5, 7));

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("monthKey는 YYYY-MM 형식이어야 합니다.");
  }

  return { monthKey: normalized, year, month };
}

function toKstMorningUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function buildPublishDates(year: number, month: number, count: number) {
  const dates: Date[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));

  while (cursor.getUTCMonth() === month - 1 && dates.length < count) {
    const dayOfWeek = cursor.getUTCDay();
    if (dayOfWeek === 2 || dayOfWeek === 4) {
      dates.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (dates.length >= count) {
    return dates.slice(0, count);
  }

  const lastDay = new Date(Date.UTC(year, month, 0, 0, 0, 0)).getUTCDate();
  for (let day = 1; dates.length < count && day <= lastDay; day += 7) {
    dates.push(toKstMorningUtcDate(year, month, Math.min(day, lastDay)));
  }

  return dates.slice(0, count);
}

function determineOptimalPlanCount(params: {
  topics: PlanningTopic[];
  snapshot: PlanningSnapshot;
  performanceFeedback?: PlanningPerformanceFeedback;
}) {
  let count = 4;

  const strongTopics = params.topics.filter((topic) => (topic.score ?? 0) >= 7).length;
  if (strongTopics >= 6) {
    count += 2;
  } else if (strongTopics >= 4) {
    count += 1;
  }

  if (params.snapshot.configured && !params.snapshot.error) {
    count += 1;
  }

  if ((params.performanceFeedback?.publishedJobs ?? 0) >= 6) {
    count += 1;
  }

  if ((params.performanceFeedback?.failedPublications ?? 0) >= 3) {
    count -= 1;
  }

  if ((params.performanceFeedback?.channelMix.length ?? 0) >= 2) {
    count += 1;
  }

  return Math.max(4, Math.min(8, count));
}

function buildWeekLabel(index: number, totalCount: number) {
  if (totalCount <= 4) {
    return `${index + 1}주차`;
  }

  const weekIndex = Math.floor(index / 2) + 1;
  const slotLabel = index % 2 === 0 ? "1차" : "2차";
  return `${weekIndex}주차 ${slotLabel}`;
}

function buildBasisSummary(params: {
  project: PlanningProject;
  snapshot: PlanningSnapshot;
  monthLabel: string;
  approvedProfile: PlanningBrandProfile;
  performanceFeedback?: PlanningPerformanceFeedback;
  plannedCount: number;
}) {
  const metrics = params.snapshot.metricCards
    .map((item) => `${item.label} ${item.value}`)
    .slice(0, 4)
    .join(" · ");
  const topSource = params.snapshot.trafficSources[0]?.label || "유입 채널 데이터 없음";
  const topPage = params.snapshot.topPages[0];
  const sourceDetail = params.snapshot.sourcePaths[0]
    ? `${params.snapshot.sourcePaths[0].source}/${params.snapshot.sourcePaths[0].medium} ${params.snapshot.sourcePaths[0].ratio}`
    : "대표 소스 데이터 없음";
  const analyticsNote = params.snapshot.error
    ? `GA4 연결 오류(${params.snapshot.error})로 브랜드 컨텍스트 중심 계획으로 보정했습니다.`
    : params.snapshot.configured
      ? `최근 성과 기준 핵심 유입은 ${topSource}이며, 대표 유입 소스는 ${sourceDetail}입니다.`
      : "GA4 속성이 아직 없어 브랜드 컨텍스트와 기존 주제 우선순위를 기준으로 계획했습니다.";
  const performanceNote = params.performanceFeedback
    ? [
        params.performanceFeedback.publishedJobs > 0
          ? `최근 발행 완료 콘텐츠는 ${params.performanceFeedback.publishedJobs}건입니다.`
          : "",
        params.performanceFeedback.successfulPublications > 0
          ? `채널 게시 성공은 ${params.performanceFeedback.successfulPublications}건이며 ${params.performanceFeedback.channelMix
              .slice(0, 3)
              .map((item) => `${item.channel} ${item.count}건`)
              .join(" · ")} 흐름이 누적되었습니다.`
          : "",
        params.performanceFeedback.failedPublications > 0
          ? `반면 실패 이력 ${params.performanceFeedback.failedPublications}건은 후속 계획에서 운영 리스크로 반영합니다.`
          : "",
        params.performanceFeedback.recentPublishedTopics.length > 0
          ? `최근 발행 주제는 ${params.performanceFeedback.recentPublishedTopics.slice(0, 2).join(", ")} 입니다.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return [
    `${params.monthLabel} 운영 초점은 ${params.project.name}의 브랜드 컨텍스트를 유지하면서 검색형 블로그 원문과 SNS 파생 효율을 함께 높이는 것입니다. 이번 달 권장 발행 수는 ${params.plannedCount}건으로 계산했습니다.`,
    metrics ? `최근 성과 요약: ${metrics}.` : "",
    topPage ? `가장 반응이 높은 페이지는 ${topPage.path} (${topPage.views}뷰)로, ${topPage.title}와 가까운 문제 해결형 주제를 우선 반영합니다.` : "",
    analyticsNote,
    performanceNote,
    `승인된 타겟은 ${params.approvedProfile.audience || "실무 담당자"}이며, 기본 CTA는 ${params.approvedProfile.cta || "자세히 보기"}입니다.`,
  ].filter(Boolean).join(" ");
}

function normalizeIntent(intentType?: string | null) {
  if (!intentType) {
    return "informational";
  }

  return intentType;
}

function buildObjective(params: {
  monthFocus: string;
  angle: string;
  topic: string;
  project: PlanningProject;
  profile: PlanningBrandProfile;
}) {
  return `${params.monthFocus} 시점에 맞춰 ${params.topic}를 네이버 블로그 원문으로 설명하고, ${params.project.name}의 ${params.profile.cta || "문의/상담"} 흐름으로 자연스럽게 연결합니다. ${params.angle} 관점을 포함해 실무 체크포인트를 명확히 제시합니다.`;
}

function buildRationale(params: {
  topic: PlanningTopic;
  publishAt: Date;
  monthFocus: string;
  angle: string;
  snapshot: PlanningSnapshot;
}) {
  const topPage = params.snapshot.topPages[0];
  const source = params.snapshot.trafficSources[0];
  const publishLabel = params.publishAt.toISOString().slice(0, 10);

  return [
    `${publishLabel} 발행 슬롯에 맞춰 ${params.monthFocus} 맥락을 반영했습니다.`,
    params.topic.rationale || `${params.angle} 중심으로 재구성해 검색 유입형 블로그와 SNS 파생 효율을 동시에 노립니다.`,
    topPage ? `최근 상위 페이지 ${topPage.path}의 반응을 기준으로 유사한 문제 해결형 흐름을 유지합니다.` : "",
    source ? `대표 유입 채널 ${source.label} 비중이 높아 초반 후킹과 CTA를 명확히 두는 방향이 적합합니다.` : "",
  ].filter(Boolean).join(" ");
}

export function buildMonthlyContentPlan(params: {
  project: PlanningProject;
  approvedProfile: PlanningBrandProfile;
  topics: PlanningTopic[];
  snapshot: PlanningSnapshot;
  performanceFeedback?: PlanningPerformanceFeedback;
  monthKey?: string;
}): GeneratedContentPlan {
  const { monthKey, year, month } = parseMonthKey(params.monthKey);
  const focus = MONTH_FOCUS[month];
  const generatedAt = new Date();
  const optimalCount = determineOptimalPlanCount({
    topics: params.topics,
    snapshot: params.snapshot,
    performanceFeedback: params.performanceFeedback,
  });
  const publishDates = buildPublishDates(year, month, optimalCount);
  const rankedTopics = [...params.topics]
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, Math.max(optimalCount, Math.min(8, params.topics.length || optimalCount)));

  const fallbackTopics = rankedTopics.length > 0
    ? rankedTopics
    : [
        {
          title: `${params.project.name} ${focus.angles[0]} 체크리스트`,
          intentType: "informational",
          score: 8,
          rationale: "GA4 데이터가 제한적일 때 브랜드 핵심 설명형 콘텐츠부터 시작합니다.",
        },
        {
          title: `${params.project.name} 도입 전 확인해야 할 핵심 포인트`,
          intentType: "consideration",
          score: 7,
          rationale: "도입 검토 독자가 바로 활용할 수 있는 설명형 콘텐츠가 필요합니다.",
        },
        {
          title: `${params.project.name} 실무 적용 예시와 운영 흐름`,
          intentType: "commercial",
          score: 7,
          rationale: "상담 전환 직전 독자에게 실제 활용 흐름을 제시합니다.",
        },
        {
          title: `${params.project.name} 자주 묻는 질문 정리`,
          intentType: "transactional",
          score: 6,
          rationale: "결정 전 장벽을 낮추는 FAQ형 토픽이 필요합니다.",
        },
      ];

  return {
    monthKey,
    status: "draft",
    basisSummary: buildBasisSummary({
      project: params.project,
      snapshot: params.snapshot,
      monthLabel: `${month}월 ${focus.label}`,
      approvedProfile: params.approvedProfile,
      performanceFeedback: params.performanceFeedback,
      plannedCount: publishDates.length,
    }),
    autoGenerate: true,
    generatedAt,
    items: publishDates.map((publishAt, index) => {
      const topic = fallbackTopics[index % fallbackTopics.length];
      const angle = focus.angles[index % focus.angles.length];
      const weekLabel = buildWeekLabel(index, publishDates.length);

      return {
        sortOrder: index + 1,
        weekLabel,
        publishAt,
        topic: topic.title,
        intentType: normalizeIntent(topic.intentType),
        objective: buildObjective({
          monthFocus: focus.label,
          angle,
          topic: topic.title,
          project: params.project,
          profile: params.approvedProfile,
        }),
        rationale: buildRationale({
          topic,
          publishAt,
          monthFocus: focus.label,
          angle,
          snapshot: params.snapshot,
        }),
        status: "planned",
        generatedAt,
      };
    }),
  };
}
