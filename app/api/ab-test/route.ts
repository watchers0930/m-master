// POST /api/ab-test  — 단일 → AB 승격: source 콘텐츠 + 변형 B 1개 자동 생성 (status='draft')
// GET  /api/ab-test  — 본인 ab_tests 목록

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isBudgetExceeded } from '@/lib/cost/budget';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { generateVariantBFromSource, GenerateFailedError } from '@/lib/ab-test/generate-pair';
import type {
  AbTestCreateResponse,
  AbTestListResponse,
  AbTestListRow,
} from '@/types/api';
import type { Content } from '@/types/db';

// 단일 → AB 승격 시그니처
const CreateRequestSchema = z.object({
  source_content_id: z.string().uuid(),
  measure_days: z
    .union([z.literal(7), z.literal(14), z.literal(30)])
    .optional()
    .default(14),
});

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { data: null, error: { code, message } },
    { status },
  );
}

// ----------------------------------------------------------------
// POST — 생성
// ----------------------------------------------------------------
export async function POST(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('bad_request', 'JSON 파싱 실패', 400); }

  const parsed = CreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);
  }

  const req = parsed.data;

  // 1) source 콘텐츠 조회 — 본인 소유 + channel='blog' 검증
  const srcRow = await prisma.content.findUnique({
    where: { id: req.source_content_id },
  });

  if (!srcRow || srcRow.ownerId !== ownerId) {
    return jsonError('not_found', '소스 콘텐츠를 찾을 수 없습니다', 404);
  }
  const source = srcRow as unknown as Content;
  if (source.channel !== 'blog') {
    return jsonError(
      'invalid_state',
      'A/B 테스트는 블로그 채널 콘텐츠만 지원합니다',
      422,
    );
  }

  // 2) 예산 체크 (변형 1개 신규 생성)
  if (await isBudgetExceeded()) {
    return jsonError('budget_exceeded', '월 예산 한도 초과. 설정에서 한도를 조정하세요.', 429);
  }

  // 3) 변형 B 1개 자동 생성 — source의 topic/tone/keywords 그대로, "다른 컨셉" 시드 적용
  let variantB;
  try {
    variantB = await generateVariantBFromSource({
      ownerId,
      topic: source.topic,
      channel: source.channel,
      tone: source.tone,
      keywords: (source.keywords as string[]) ?? [],
      useRag: false,
    });
  } catch (err) {
    if (err instanceof GenerateFailedError) {
      console.error('[ab-test POST] generate_failed:', err.message);
      return jsonError('generate_failed', '변형 생성에 실패했습니다. 다시 시도해주세요.', 502);
    }
    console.error('[ab-test POST] 예외:', err);
    return jsonError('internal', '서버 오류', 500);
  }

  // 4) ab_tests insert (variant_a = source, variant_b = 신규)
  let abRow;
  try {
    abRow = await prisma.abTest.create({
      data: {
        ownerId,
        topic: source.topic,
        channel: source.channel,
        tone: source.tone,
        keywords: (source.keywords as string[]) ?? null,
        variantAId: source.id,
        variantBId: variantB.contentId,
        status: 'draft',
        measureDays: req.measure_days,
      },
    });
  } catch (insertError) {
    console.error('[ab-test POST] ab_tests insert 실패:', insertError);
    // 신규 변형 B만 정리 (source는 보존)
    await prisma.content.delete({ where: { id: variantB.contentId } });
    return jsonError('db_error', 'ab_tests 생성 실패', 500);
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.AB_TEST_CREATE,
    targetType: 'ab_test',
    targetId: abRow.id,
    payload: {
      topic: source.topic,
      channel: source.channel,
      variant_a_id: source.id,
      variant_b_id: variantB.contentId,
      cost_krw_total: variantB.costKrw,
      measure_days: req.measure_days,
      source_content_id: req.source_content_id,
    },
  });

  const sourceScores = source.scores ?? null;
  const response: AbTestCreateResponse = {
    id: abRow.id,
    variant_a: {
      id: source.id,
      topic: source.topic,
      text_body: source.text_body,
      image_url: source.image_url,
      scores: sourceScores,
      cost_krw: source.cost_krw,
    },
    variant_b: {
      id: variantB.contentId,
      topic: source.topic,
      text_body: variantB.textBody,
      image_url: variantB.imageUrl,
      scores: variantB.scores,
      cost_krw: variantB.costKrw,
    },
    status: 'draft',
    cost_krw_total: variantB.costKrw,
  };

  return NextResponse.json({ data: response, error: null });
}

// ----------------------------------------------------------------
// GET — 목록
// ----------------------------------------------------------------
const ListQuerySchema = z.object({
  status: z.enum(['draft', 'running', 'completed', 'cancelled']).optional(),
  channel: z.enum(['blog', 'instagram', 'facebook']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const sp = request.nextUrl.searchParams;
  const parsed = ListQuerySchema.safeParse({
    status: sp.get('status') ?? undefined,
    channel: sp.get('channel') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    limit: sp.get('limit') ?? undefined,
    offset: sp.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);
  }
  const q = parsed.data;

  const where: Record<string, unknown> = { ownerId };
  if (q.status) where.status = q.status;
  if (q.channel) where.channel = q.channel;
  if (q.from || q.to) {
    const createdAtFilter: Record<string, string> = {};
    if (q.from) createdAtFilter.gte = q.from;
    if (q.to) createdAtFilter.lte = q.to;
    where.createdAt = createdAtFilter;
  }

  try {
    const [data, count] = await Promise.all([
      prisma.abTest.findMany({
        where,
        include: {
          variantA: { select: { topic: true } },
          variantB: { select: { topic: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: q.offset,
        take: q.limit,
      }),
      prisma.abTest.count({ where }),
    ]);

    const rows: AbTestListRow[] = data.map((r) => {
      const { variantA, variantB, ...rest } = r;
      return {
        ...rest,
        variant_a_topic: variantA?.topic ?? '',
        variant_b_topic: variantB?.topic ?? '',
      } as unknown as AbTestListRow;
    });

    const response: AbTestListResponse = {
      data: rows,
      total: count,
    };
    return NextResponse.json({ data: response, error: null });
  } catch (error) {
    console.error('[ab-test GET] db_error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('db_error', message, 500);
  }
}
