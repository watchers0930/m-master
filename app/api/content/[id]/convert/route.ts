// POST /api/content/[id]/convert
// 블로그 콘텐츠를 인스타/페이스북 형식으로 변환 + 새 contents row insert
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isBudgetExceeded } from '@/lib/cost/budget';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const RequestSchema = z.object({
  channel: z.enum(['instagram', 'facebook']),
});

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { data: null, error: { code, message } },
    { status },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('bad_request', 'JSON 파싱 실패', 400); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return jsonError('validation', parsed.error.issues[0]?.message ?? 'validation error', 400);

  const { channel } = parsed.data;

  // 1) 원본 블로그 조회
  const source = await prisma.content.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      channel: true,
      topic: true,
      tone: true,
      keywords: true,
      textBody: true,
      imageUrl: true,
      bodyImageUrls: true,
    },
  });

  if (!source) return jsonError('not_found', '원본 콘텐츠를 찾을 수 없습니다', 404);
  if (source.ownerId !== ownerId) return jsonError('forbidden', '권한 없음', 403);
  if (source.channel !== 'blog') return jsonError('invalid_state', '블로그 콘텐츠만 변환 가능합니다', 422);
  if (!source.textBody) return jsonError('invalid_state', '본문이 비어있습니다', 422);

  // 2) 예산 체크
  if (await isBudgetExceeded()) {
    return jsonError('budget_exceeded', '월 예산 한도 초과', 429);
  }

  // 3) Claude 변환
  let convertResult;
  try {
    convertResult = await convertBlogToChannel(source.textBody, source.topic, channel);
  } catch (err) {
    console.error(`[convert/${channel}] Claude 호출 실패:`, err);
    return jsonError('convert_failed', '변환 실패. 다시 시도해주세요.', 502);
  }

  // 4) DB insert — 새 채널의 contents row
  const newRow = await prisma.content.create({
    data: {
      ownerId,
      channel,
      topic: source.topic,
      tone: source.tone,
      keywords: (source.keywords as string[]) ?? [],
      textBody: convertResult.text,
      imageUrl: source.imageUrl,
      bodyImageUrls: [],
      scores: Prisma.DbNull,
      costKrw: convertResult.krw,
      status: 'draft',
    },
    select: { id: true },
  });

  // 5) cost_ledger
  await trackCost({
    kind: 'chat',
    tokensIn: convertResult.usage.prompt_tokens,
    tokensOut: convertResult.usage.completion_tokens,
    krw: convertResult.krw,
    contentId: newRow.id,
  });

  // 6) audit
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.CONTENT_GENERATE,
    targetType: 'content',
    targetId: newRow.id,
    payload: { source_id: id, channel, cost_krw: convertResult.krw },
  });

  return NextResponse.json({
    data: {
      id: newRow.id,
      channel,
      text: convertResult.text,
      cost_krw: convertResult.krw,
    },
    error: null,
  });
}
