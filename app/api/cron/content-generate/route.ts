// app/api/cron/content-generate/route.ts — 일일 자동 콘텐츠 생성 + 매주 월요일 토픽 리프레시
// Vercel Cron: 0 22 * * * (UTC) = 오전 7시 KST
// 50% 확률로 스킵 → schedule-publish(8시)에서 ?fallback=1로 폴백 호출 → 실질적으로 7시/8시 랜덤
// 1) 매주 월요일: 추천 토픽 자동 생성 → ContentPlan + Items 자동 생성 (topics-refresh 통합)
// 2) 매일(월~일): ContentPlanItem(scheduledDate=오늘, status=planned, plan.autoGenerate=true) 순차 생성·발행

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret, getTodayKST } from '@/lib/cron/auth';
import { prisma } from '@/lib/prisma';
import { generateContentHeadless } from '@/lib/content/generate-headless';
import { autoPublishToSocial } from '@/lib/publish/auto-publish';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { calcChatKrw } from '@/lib/claude/chat';
import { trackCost } from '@/lib/cost/tracker';
import { fetchPopularPages, type PopularPage } from '@/lib/ga4/popular-pages';
import { buildCandidates } from '@/lib/topics/candidates';
import { recommendTopFive } from '@/lib/topics/recommend';
import { getMondayOfWeekKST, getWeekdayDates, isMondayKST } from '@/lib/topics/week-utils';
import { Prisma } from '@prisma/client';
import { checkContentLimit, checkCostLimit, getUserPlan } from '@/lib/billing/limits';

export const maxDuration = 300; // 5분 (Vercel Pro)
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// 멀티테넌트: 대상 유저 조회 + 시간 예산
// ---------------------------------------------------------------------------
interface EligibleUser { id: string; email: string }

async function getEligibleUsers(): Promise<EligibleUser[]> {
  return prisma.user.findMany({
    where: {
      OR: [
        // 유료 플랜 + 활성 구독
        {
          plan: { in: ['starter', 'pro'] },
          subscriptions: { some: { status: 'active' } },
        },
        // 기존 autoGenerate 플랜 보유 유저 (하위 호환 — 마이그레이션 전 기존 유저 포함)
        { contentPlans: { some: { autoGenerate: true, status: 'active' } } },
      ],
    },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
}

function getRemainingMs(startTime: number, budgetMs = 270_000): number {
  return budgetMs - (Date.now() - startTime);
}


// ---------------------------------------------------------------------------
// 매주 월요일: 추천 토픽 리프레시 (주간 전환)
// ---------------------------------------------------------------------------
interface Ga4Data { popular: PopularPage[] | null; unavailable: boolean }

async function refreshWeeklyTopicsForUser(
  today: string,
  ownerId: string,
  ga4Data: Ga4Data,
): Promise<{ count?: number; error?: string }> {
  const weekStart = getMondayOfWeekKST(today);
  const monthYmd = today.slice(0, 7) + '-01';

  try {
    // 이미 이번 주 토픽이 있으면 스킵 (idempotent)
    const existing = await prisma.topicRecommendation.count({
      where: { weekStart, channel: 'blog', ownerId },
    });
    if (existing >= 7) {
      console.log(`[cron/content-generate] [${ownerId}] 토픽 이미 ${existing}건 — 스킵`);
      return { count: existing };
    }

    // 해당 유저의 발행 이력 기반 중복 제거
    const [contents, userSettings] = await Promise.all([
      prisma.content.findMany({
        where: { ownerId },
        select: { topic: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.setting.findUnique({
        where: { ownerId },
        select: { brandGuide: true },
      }),
    ]);
    const publishedTopics = contents.map(c => c.topic).filter((t): t is string => !!t);

    const bg = (userSettings?.brandGuide ?? {}) as Record<string, unknown>;
    const businessContext = {
      industry: bg.industry as string | undefined,
      coreKeywords: bg.core_keywords as string[] | undefined,
      services: bg.services as string[] | undefined,
      companyName: bg.company_name as string | undefined,
    };

    const candidates = buildCandidates({
      monthYmd,
      publishedTopics,
      ga4PopularPaths: ga4Data.popular ?? undefined,
      businessContext,
    });
    if (candidates.length === 0) {
      return { error: 'no_candidates' };
    }

    const recommended = await recommendTopFive({ monthYmd, candidates, channel: 'blog', businessContext });

    // 같은 주·같은 유저 기존 토픽 삭제 (재실행 대비)
    await prisma.topicRecommendation.deleteMany({
      where: { weekStart, channel: 'blog', ownerId },
    });

    const signalsByTopic = new Map(candidates.map(c => [c.topic, c.signal]));

    const rows = recommended.items.map(item => {
      const factors: Record<string, Prisma.InputJsonValue> = {
        tags: item.tags as unknown as Prisma.InputJsonValue,
        reason: item.reason,
        signal: signalsByTopic.get(item.topic) ?? 'core',
      };
      if (ga4Data.unavailable) factors.ga4_unavailable = true;
      return {
        ownerId,
        weekStart,
        topic: item.topic,
        score: item.score,
        channel: 'blog' as const,
        factors: factors as Prisma.InputJsonValue,
      };
    });

    const inserted = await prisma.$transaction(
      rows.map(row => prisma.topicRecommendation.create({ data: row })),
    );

    const krw = calcChatKrw(recommended.usage);
    await trackCost({
      ownerId,
      kind: 'chat',
      tokensIn: recommended.usage.prompt_tokens,
      tokensOut: recommended.usage.completion_tokens,
      krw,
    });

    await logAudit({
      actor: null,
      action: AUDIT_ACTIONS.CRON_TOPICS_REFRESH,
      targetType: 'topic_recommendations',
      targetId: weekStart,
      payload: { weekStart, ownerId, count: inserted.length, ga4_unavailable: ga4Data.unavailable, cost_krw: krw },
    });

    console.log(`[cron/content-generate] [${ownerId}] 토픽 리프레시 완료 — ${inserted.length}건`);
    return { count: inserted.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/content-generate] [${ownerId}] 토픽 리프레시 실패:`, msg);
    return { error: msg };
  }
}

// ---------------------------------------------------------------------------
// 매주 월요일: 토픽 5개 → ContentPlan + ContentPlanItem 자동 생성
// ---------------------------------------------------------------------------
async function createWeeklyPlanForUser(
  today: string,
  ownerId: string,
): Promise<{ planId?: string; itemCount?: number; error?: string }> {
  const weekStart = getMondayOfWeekKST(today);

  try {
    // 이미 이번 주 플랜이 있으면 스킵 (@@unique([ownerId, weekKey]))
    const existingPlan = await prisma.contentPlan.findUnique({
      where: { ownerId_weekKey: { ownerId, weekKey: weekStart } },
    });
    if (existingPlan) {
      console.log(`[cron/content-generate] [${ownerId}] 주간 플랜 이미 존재 — 스킵`);
      return { planId: existingPlan.id, itemCount: 0 };
    }

    // 해당 유저의 이번 주 토픽 조회
    const topics = await prisma.topicRecommendation.findMany({
      where: { weekStart, channel: 'blog', ownerId },
      orderBy: { score: 'desc' },
      take: 7,
    });

    if (topics.length === 0) {
      return { error: 'no_topics' };
    }

    const weekdays = getWeekdayDates(weekStart);

    const plan = await prisma.contentPlan.create({
      data: {
        ownerId,
        weekKey: weekStart,
        status: 'active',
        autoGenerate: true,
        items: {
          create: topics.map((topic, idx) => ({
            sortOrder: idx,
            topic: topic.topic,
            scheduledDate: weekdays[idx] ?? weekdays[weekdays.length - 1],
            status: 'planned',
          })),
        },
      },
      include: { items: true },
    });

    await logAudit({
      actor: null,
      action: AUDIT_ACTIONS.CRON_WEEKLY_PLAN,
      targetType: 'content_plan',
      targetId: plan.id,
      payload: { weekStart, ownerId, itemCount: plan.items.length },
    });

    console.log(`[cron/content-generate] [${ownerId}] 주간 플랜 생성 — ${plan.items.length}건`);
    return { planId: plan.id, itemCount: plan.items.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/content-generate] [${ownerId}] 주간 플랜 실패:`, msg);
    return { error: msg };
  }
}

// ---------------------------------------------------------------------------
// GET handler (Vercel Cron은 GET으로 호출)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const today = getTodayKST();

  // 랜덤 실행: 50% 확률로 7시에 실행, 나머지는 8시(schedule-publish)에서 폴백
  const isFallback = request.nextUrl.searchParams.get('fallback') === '1';
  if (!isFallback && Math.random() < 0.5) {
    console.log(`[cron/content-generate] 오늘은 8시에 실행 예정 (random delay) — ${today}`);
    return NextResponse.json({ ok: true, delayed: true, date: today });
  }

  console.log(`[cron/content-generate] 실행 시작 — 날짜: ${today}`);

  // 1. 대상 유저 조회
  const eligibleUsers = await getEligibleUsers();
  if (eligibleUsers.length === 0) {
    console.log('[cron/content-generate] 대상 유저 없음');
    return NextResponse.json({ ok: true, date: today, users: 0, processed: 0 });
  }
  console.log(`[cron/content-generate] 대상 유저 ${eligibleUsers.length}명: ${eligibleUsers.map(u => u.email).join(', ')}`);

  // 2. 월요일이면 GA4 데이터 1회 fetch (전역 — 유저별 반복 불필요)
  const monday = isMondayKST(today);
  const ga4Data: Ga4Data = { popular: null, unavailable: false };
  if (monday) {
    try {
      ga4Data.popular = await fetchPopularPages(30);
      if (ga4Data.popular === null) ga4Data.unavailable = true;
    } catch {
      ga4Data.unavailable = true;
    }
  }

  // 3. 유저별 토픽 리프레시 + 주간 플랜 생성
  const perUser: Record<string, { topics?: object; plan?: object }> = {};

  for (const user of eligibleUsers) {
    if (getRemainingMs(startTime) < 30_000) {
      console.log(`[cron/content-generate] 시간 부족 — 나머지 유저 스킵 (${user.email}~)`);
      break;
    }

    if (monday) {
      const topicsResult = await refreshWeeklyTopicsForUser(today, user.id, ga4Data);
      perUser[user.id] = { topics: topicsResult };
    }

    // 요일 무관: 이번 주 플랜이 없으면 자동 생성 (월요일 실패 시 복구 보장)
    const planResult = await createWeeklyPlanForUser(today, user.id);
    if (!perUser[user.id]) perUser[user.id] = {};
    perUser[user.id].plan = planResult;
  }

  // 4. 오늘 예정된 planned 항목 조회 (모든 유저 대상 — 이미 per-ownerId 스코프)
  const items = await prisma.contentPlanItem.findMany({
    where: {
      scheduledDate: today,
      status: 'planned',
      plan: { autoGenerate: true, status: 'active' },
    },
    include: { plan: { select: { ownerId: true } } },
    orderBy: { sortOrder: 'asc' },
  });

  if (items.length === 0) {
    console.log('[cron/content-generate] 오늘 예정 항목 없음');
    return NextResponse.json({
      ok: true, date: today, users: eligibleUsers.length,
      processed: 0, perUser: monday ? perUser : undefined,
    });
  }

  console.log(`[cron/content-generate] ${items.length}건 처리 시작`);

  // 5. 콘텐츠 순차 생성·발행
  const results: Array<{ itemId: string; ownerId: string; status: string; contentId?: string; error?: string }> = [];

  for (const item of items) {
    if (getRemainingMs(startTime) < 60_000) {
      console.log('[cron/content-generate] 시간 부족 — 나머지 항목 스킵');
      break;
    }

    const ownerId = item.plan.ownerId;

    try {
      // 원자적 잠금: planned → generating (중복 실행 방지)
      const claimed = await prisma.contentPlanItem.updateMany({
        where: { id: item.id, status: 'planned' },
        data: { status: 'generating' },
      });
      if (claimed.count === 0) {
        console.log(`[cron/content-generate] [${ownerId}] ${item.topic} — 다른 인스턴스가 이미 처리 중, 스킵`);
        continue;
      }

      // 플랜 제한 체크 (콘텐츠 수 + 비용 한도)
      const userPlan = await getUserPlan(ownerId);
      await checkContentLimit(ownerId, userPlan);
      await checkCostLimit(ownerId, userPlan);

      const result = await generateContentHeadless({
        topic: item.topic,
        channel: 'blog',
        ownerId,
      });

      await autoPublishToSocial({
        blogContentId: result.contentId,
        ownerId,
        blogText: result.text,
        topic: item.topic,
        imageUrl: result.imageUrl,
        bodyImageUrls: result.bodyImageUrls,
        blogScores: result.scores ?? null,
        onProgress: () => {},
      });

      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: { status: 'generated', contentJobId: result.contentId, generatedAt: new Date() },
      });

      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_CONTENT_GENERATE,
        targetType: 'content_plan_item',
        targetId: item.id,
        payload: { contentId: result.contentId, topic: item.topic, costKrw: result.costKrw, date: today },
      });

      results.push({ itemId: item.id, ownerId, status: 'generated', contentId: result.contentId });
      console.log(`[cron/content-generate] ✓ [${ownerId}] ${item.topic} → ${result.contentId}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/content-generate] ✗ [${ownerId}] ${item.topic}:`, errorMsg);

      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: { status: 'failed' },
      }).catch(() => {});

      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_CONTENT_GENERATE,
        targetType: 'content_plan_item',
        targetId: item.id,
        payload: { topic: item.topic, error: errorMsg, date: today },
      }).catch(() => {});

      results.push({ itemId: item.id, ownerId, status: 'failed', error: errorMsg });
    }
  }

  const generated = results.filter(r => r.status === 'generated').length;
  const failed = results.filter(r => r.status === 'failed').length;
  console.log(`[cron/content-generate] 완료 — 유저: ${eligibleUsers.length}, 성공: ${generated}, 실패: ${failed}`);

  return NextResponse.json({
    ok: true, date: today,
    users: eligibleUsers.length,
    processed: items.length, generated, failed,
    results,
    perUser: monday ? perUser : undefined,
  });
}
