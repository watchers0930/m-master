// app/api/cron/content-generate/route.ts — 일일 자동 콘텐츠 생성 cron
// Vercel Cron: 0 22 * * * (UTC) = 오전 7시 KST
// ContentPlanItem(scheduledDate=오늘, status=planned, plan.autoGenerate=true) 조회 후 순차 생성·발행

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateContentHeadless } from '@/lib/content/generate-headless';
import { autoPublishToSocial } from '@/lib/publish/auto-publish';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

export const maxDuration = 300; // 5분 (Vercel Pro)
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// CRON_SECRET 인증
// ---------------------------------------------------------------------------
function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// 오늘 날짜 (KST) → 'YYYY-MM-DD'
// ---------------------------------------------------------------------------
function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// GET handler (Vercel Cron은 GET으로 호출)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getTodayKST();
  console.log(`[cron/content-generate] 실행 시작 — 날짜: ${today}`);

  // 오늘 예정된 planned 항목 조회 (autoGenerate=true인 플랜만)
  const items = await prisma.contentPlanItem.findMany({
    where: {
      scheduledDate: today,
      status: 'planned',
      plan: {
        autoGenerate: true,
        status: 'active',
      },
    },
    include: {
      plan: { select: { ownerId: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  if (items.length === 0) {
    console.log('[cron/content-generate] 오늘 예정 항목 없음');
    return NextResponse.json({ ok: true, processed: 0, date: today });
  }

  console.log(`[cron/content-generate] ${items.length}건 처리 시작`);

  const results: Array<{ itemId: string; status: string; contentId?: string; error?: string }> = [];

  for (const item of items) {
    const ownerId = item.plan.ownerId;

    try {
      // item.status → generating
      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: { status: 'generating' },
      });

      // 콘텐츠 생성
      const result = await generateContentHeadless({
        topic: item.topic,
        channel: 'blog',
        ownerId,
        useRag: true,
      });

      // 소셜 자동 발행 (onProgress는 no-op)
      await autoPublishToSocial({
        blogContentId: result.contentId,
        ownerId,
        blogText: result.text,
        topic: item.topic,
        imageUrl: result.imageUrl,
        bodyImageUrls: result.bodyImageUrls,
        onProgress: () => {},
      });

      // item.status → generated
      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: {
          status: 'generated',
          contentJobId: result.contentId,
          generatedAt: new Date(),
        },
      });

      // audit log
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_CONTENT_GENERATE,
        targetType: 'content_plan_item',
        targetId: item.id,
        payload: {
          contentId: result.contentId,
          topic: item.topic,
          costKrw: result.costKrw,
          date: today,
        },
      });

      results.push({ itemId: item.id, status: 'generated', contentId: result.contentId });
      console.log(`[cron/content-generate] ✓ ${item.topic} → ${result.contentId}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/content-generate] ✗ ${item.topic}:`, errorMsg);

      // item.status → failed
      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: { status: 'failed' },
      }).catch(() => {});

      // audit log (실패)
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_CONTENT_GENERATE,
        targetType: 'content_plan_item',
        targetId: item.id,
        payload: { topic: item.topic, error: errorMsg, date: today },
      }).catch(() => {});

      results.push({ itemId: item.id, status: 'failed', error: errorMsg });
      // 다음 항목 계속 진행
    }
  }

  const generated = results.filter((r) => r.status === 'generated').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  console.log(`[cron/content-generate] 완료 — 성공: ${generated}, 실패: ${failed}`);

  return NextResponse.json({ ok: true, date: today, processed: items.length, generated, failed, results });
}
