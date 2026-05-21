// GET    /api/ab-test/[id] — 단건 + 두 변형 join
// PATCH  /api/ab-test/[id] — URL 입력/상태 머신
// DELETE /api/ab-test/[id] — 삭제 (running 시 422)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { extractPath, InvalidUrlError } from '@/lib/ab-test/url-utils';
import { buildCompletionFromGa4 } from '@/lib/ab-test/state';
import type { AbTest, AbTestUpdate } from '@/types/db';
import type { AbTestDetail } from '@/types/api';

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { data: null, error: { code, message } },
    { status },
  );
}

async function loadTest(id: string, ownerId: string): Promise<AbTest | null> {
  const data = await prisma.abTest.findFirst({
    where: { id, ownerId },
  });
  return (data as unknown as AbTest) ?? null;
}

// ----------------------------------------------------------------
// GET — 상세 + 두 변형 join
// ----------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id } = await params;

  const data = await prisma.abTest.findFirst({
    where: { id, ownerId },
    include: {
      variantA: true,
      variantB: true,
    },
  });

  if (!data) {
    return jsonError('not_found', 'A/B 테스트를 찾을 수 없습니다', 404);
  }

  const variantA = data.variantA;
  const variantB = data.variantB;

  if (!variantA || !variantB) {
    return jsonError('not_found', '변형 콘텐츠가 누락되었습니다', 404);
  }

  const { variantA: _va, variantB: _vb, ...rest } = data;
  void _va; void _vb;

  const detail: AbTestDetail = {
    ...(rest as unknown as AbTest),
    variant_a: variantA as unknown as AbTestDetail['variant_a'],
    variant_b: variantB as unknown as AbTestDetail['variant_b'],
  };

  return NextResponse.json({ data: detail, error: null });
}

// ----------------------------------------------------------------
// PATCH — 상태 머신
// ----------------------------------------------------------------
const PatchSchema = z.object({
  variant_a_url: z.string().url().nullable().optional(),
  variant_b_url: z.string().url().nullable().optional(),
  measure_days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
  action: z.enum(['start', 'complete', 'confirm_winner', 'cancel']).optional(),
  winner: z.enum(['a', 'b', 'tie']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('bad_request', 'JSON 파싱 실패', 400); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);
  }
  const patch = parsed.data;

  const before = await loadTest(id, ownerId);
  if (!before) return jsonError('not_found', 'A/B 테스트를 찾을 수 없습니다', 404);

  const update: AbTestUpdate = {};

  // ----- 1) URL 변경 차단 (running 시) -----
  const urlPatching = patch.variant_a_url !== undefined || patch.variant_b_url !== undefined;
  const measureDaysPatching = patch.measure_days !== undefined && patch.measure_days !== before.measure_days;

  if (before.status === 'running' && (urlPatching || measureDaysPatching)) {
    return jsonError(
      'invalid_state',
      '측정 중에는 URL 또는 측정기간을 변경할 수 없습니다',
      422,
    );
  }
  if (before.status === 'completed' || before.status === 'cancelled') {
    if (urlPatching || measureDaysPatching) {
      return jsonError('invalid_state', '완료/취소된 테스트는 URL/측정기간을 수정할 수 없습니다', 422);
    }
  }

  // ----- 2) URL 입력 처리 + path 추출 -----
  let nextAUrl = before.variant_a_url;
  let nextBUrl = before.variant_b_url;
  let nextAPath = before.variant_a_path;
  let nextBPath = before.variant_b_path;

  try {
    if (patch.variant_a_url !== undefined) {
      nextAUrl = patch.variant_a_url;
      nextAPath = patch.variant_a_url ? extractPath(patch.variant_a_url) : null;
      update.variant_a_url = nextAUrl;
      update.variant_a_path = nextAPath;
    }
    if (patch.variant_b_url !== undefined) {
      nextBUrl = patch.variant_b_url;
      nextBPath = patch.variant_b_url ? extractPath(patch.variant_b_url) : null;
      update.variant_b_url = nextBUrl;
      update.variant_b_path = nextBPath;
    }
  } catch (err) {
    if (err instanceof InvalidUrlError) {
      return jsonError('invalid_url', err.message, 422);
    }
    throw err;
  }

  if (patch.measure_days !== undefined) {
    update.measure_days = patch.measure_days;
  }

  // ----- 3) action 분기 -----
  const bothUrlsPresent = !!nextAUrl && !!nextBUrl;

  switch (patch.action) {
    case 'start': {
      if (before.status !== 'draft') {
        return jsonError('invalid_state', `start는 draft 상태에서만 가능합니다 (현재: ${before.status})`, 422);
      }
      if (!bothUrlsPresent) {
        return jsonError('invalid_state', '두 변형 URL을 모두 입력해야 시작할 수 있습니다', 422);
      }
      update.status = 'running';
      update.started_at = new Date().toISOString();
      break;
    }
    case 'complete': {
      if (before.status !== 'running') {
        return jsonError('invalid_state', `complete는 running 상태에서만 가능합니다 (현재: ${before.status})`, 422);
      }
      // GA4 fetch + winner 산정
      try {
        const completion = await buildCompletionFromGa4({
          ...before,
          variant_a_path: nextAPath ?? before.variant_a_path,
          variant_b_path: nextBPath ?? before.variant_b_path,
        });
        Object.assign(update, completion.update);
      } catch (err) {
        console.error('[ab-test PATCH complete] GA4 실패:', err);
        return jsonError('ga4_upstream', 'GA4 측정값 조회 실패', 502);
      }
      break;
    }
    case 'confirm_winner': {
      if (before.status !== 'completed') {
        return jsonError('invalid_state', `confirm_winner는 completed 상태에서만 가능합니다 (현재: ${before.status})`, 422);
      }
      if (!patch.winner) {
        return jsonError('validation', 'confirm_winner action에는 winner 필드가 필요합니다', 400);
      }
      update.winner = patch.winner;
      update.winner_decided_by = 'manual';
      break;
    }
    case 'cancel': {
      if (before.status !== 'draft' && before.status !== 'running') {
        return jsonError('invalid_state', `cancel은 draft/running 상태에서만 가능합니다 (현재: ${before.status})`, 422);
      }
      update.status = 'cancelled';
      break;
    }
    case undefined: {
      // action 미지정 + URL 입력만: draft에서 두 URL이 모두 채워졌으면 자동 running 전이
      if (before.status === 'draft' && bothUrlsPresent && update.status !== 'cancelled') {
        update.status = 'running';
        update.started_at = new Date().toISOString();
      }
      break;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ data: before, error: null });
  }

  // Prisma update — map snake_case update keys to camelCase
  const prismaData: Record<string, unknown> = {};
  if (update.variant_a_url !== undefined) prismaData.variantAUrl = update.variant_a_url;
  if (update.variant_b_url !== undefined) prismaData.variantBUrl = update.variant_b_url;
  if (update.variant_a_path !== undefined) prismaData.variantAPath = update.variant_a_path;
  if (update.variant_b_path !== undefined) prismaData.variantBPath = update.variant_b_path;
  if (update.measure_days !== undefined) prismaData.measureDays = update.measure_days;
  if (update.status !== undefined) prismaData.status = update.status;
  if (update.started_at !== undefined) prismaData.startedAt = update.started_at;
  if (update.completed_at !== undefined) prismaData.completedAt = update.completed_at;
  if (update.winner !== undefined) prismaData.winner = update.winner;
  if (update.winner_decided_by !== undefined) prismaData.winnerDecidedBy = update.winner_decided_by;
  if (update.ga4_snapshot !== undefined) prismaData.ga4Snapshot = update.ga4_snapshot;

  let updated;
  try {
    updated = await prisma.abTest.update({
      where: { id },
      data: prismaData,
    });
  } catch (updateError) {
    console.error('[ab-test PATCH] update 실패:', updateError);
    const message = updateError instanceof Error ? updateError.message : 'update 실패';
    return jsonError('db_error', message, 500);
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.AB_TEST_UPDATE,
    targetType: 'ab_test',
    targetId: id,
    payload: {
      action: patch.action ?? null,
      before_status: before.status,
      after_status: updated.status,
      patch,
    },
  });

  return NextResponse.json({ data: updated, error: null });
}

// ----------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id } = await params;

  const before = await loadTest(id, ownerId);
  if (!before) return jsonError('not_found', 'A/B 테스트를 찾을 수 없습니다', 404);

  if (before.status === 'running') {
    return jsonError(
      'invalid_state',
      '측정 중인 테스트는 cancel 후 삭제 가능합니다',
      422,
    );
  }

  try {
    await prisma.abTest.delete({
      where: { id },
    });
  } catch (delError) {
    console.error('[ab-test DELETE] 실패:', delError);
    const message = delError instanceof Error ? delError.message : 'Unknown error';
    return jsonError('db_error', message, 500);
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.AB_TEST_DELETE,
    targetType: 'ab_test',
    targetId: id,
    payload: { topic: before.topic, status: before.status },
  });

  return NextResponse.json({ data: { id }, error: null });
}
