// GET /api/ab-test/[id]/ga4 — 두 변형 path GA4 메트릭 조회
// 부수효과: measure_days 경과 + status='running' → 자동 completed 전이

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import {
  buildCompletionFromGa4,
  computeMeasurePeriod,
  isMeasureWindowElapsed,
} from '@/lib/ab-test/state';
import { fetchPathMetrics } from '@/lib/ga4/visitors';
import type { AbTest, AbTestPathMetrics } from '@/types/db';
import type { AbTestGa4Response } from '@/types/api';

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { data: null, error: { code, message } },
    { status },
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id } = await params;

  const row = await prisma.abTest.findFirst({
    where: { id, ownerId },
  });

  if (!row) return jsonError('not_found', 'A/B 테스트를 찾을 수 없습니다', 404);

  const test = row as unknown as AbTest;

  if (test.status === 'draft') {
    return jsonError('invalid_state', '아직 시작되지 않은 테스트입니다', 422);
  }
  if (!test.variant_a_path || !test.variant_b_path) {
    return jsonError('invalid_state', '두 변형 URL이 모두 입력되어야 합니다', 422);
  }
  if (!test.started_at) {
    return jsonError('invalid_state', 'started_at 미설정', 422);
  }

  // ----- 자동 완료 부수효과 -----
  if (test.status === 'running' && isMeasureWindowElapsed(test)) {
    let completion;
    try {
      completion = await buildCompletionFromGa4(test);
    } catch (err) {
      console.error('[ab-test ga4 GET] buildCompletionFromGa4 실패:', err);
      return jsonError('ga4_upstream', 'GA4 측정값 조회 실패', 502);
    }

    // Map completion.update to camelCase for Prisma
    const prismaData: Record<string, unknown> = {};
    const upd = completion.update;
    if (upd.status !== undefined) prismaData.status = upd.status;
    if (upd.completed_at !== undefined) prismaData.completedAt = upd.completed_at;
    if (upd.winner !== undefined) prismaData.winner = upd.winner;
    if (upd.winner_decided_by !== undefined) prismaData.winnerDecidedBy = upd.winner_decided_by;
    if (upd.ga4_snapshot !== undefined) prismaData.ga4Snapshot = upd.ga4_snapshot;

    try {
      await prisma.abTest.update({
        where: { id },
        data: prismaData,
      });
    } catch (updateError) {
      console.error('[ab-test ga4 GET] auto_complete 업데이트 실패:', updateError);
      const message = updateError instanceof Error ? updateError.message : 'Unknown error';
      return jsonError('db_error', message, 500);
    }

    await logAudit({
      actor: ownerId,
      action: AUDIT_ACTIONS.AB_TEST_AUTO_COMPLETE,
      targetType: 'ab_test',
      targetId: id,
      payload: {
        winner: completion.winner,
        manual_needed: completion.manualNeeded,
        period: completion.ga4Snapshot.period,
      },
    });

    const response: AbTestGa4Response = {
      variant_a: completion.ga4Snapshot.variant_a,
      variant_b: completion.ga4Snapshot.variant_b,
      period: completion.ga4Snapshot.period,
      auto_completed: true,
      snapshot: completion.ga4Snapshot,
    };
    return NextResponse.json({ data: response, error: null });
  }

  // ----- 일반 조회 (running/completed 모두 허용) -----
  // completed면 snapshot 우선 사용 (변하지 않음). running이면 현재값 fetch.
  if (test.status === 'completed' && test.ga4_snapshot) {
    const snap = test.ga4_snapshot;
    const response: AbTestGa4Response = {
      variant_a: snap.variant_a,
      variant_b: snap.variant_b,
      period: snap.period,
      auto_completed: false,
      snapshot: snap,
    };
    return NextResponse.json({ data: response, error: null });
  }

  // running (또는 snapshot 없는 completed) → 현재값 fetch
  const { from, to } = computeMeasurePeriod(test);
  let aMetrics: AbTestPathMetrics;
  let bMetrics: AbTestPathMetrics;
  try {
    const [aRaw, bRaw] = await Promise.all([
      fetchPathMetrics(test.variant_a_path, from, to),
      fetchPathMetrics(test.variant_b_path, from, to),
    ]);
    if (aRaw === null || bRaw === null) {
      return jsonError('ga4_upstream', 'GA4 측정값 조회 실패', 502);
    }
    const a = aRaw;
    const b = bRaw;
    aMetrics = {
      sessions: a.sessions,
      screenPageViews: a.screenPageViews,
      averageSessionDuration: a.averageSessionDuration,
      bounceRate: a.bounceRate,
      engagementRate: a.engagementRate,
    };
    bMetrics = {
      sessions: b.sessions,
      screenPageViews: b.screenPageViews,
      averageSessionDuration: b.averageSessionDuration,
      bounceRate: b.bounceRate,
      engagementRate: b.engagementRate,
    };
  } catch (err) {
    console.error('[ab-test ga4 GET] fetchPathMetrics 실패:', err);
    return jsonError('ga4_upstream', 'GA4 측정값 조회 실패', 502);
  }

  const response: AbTestGa4Response = {
    variant_a: aMetrics,
    variant_b: bMetrics,
    period: { from: from.toISOString(), to: to.toISOString() },
    auto_completed: false,
    snapshot: null,
  };
  return NextResponse.json({ data: response, error: null });
}
