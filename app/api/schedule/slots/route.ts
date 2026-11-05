// GET  /api/schedule/slots?year=2026&month=5  → 월별 슬롯 목록
// POST /api/schedule/slots                     → 슬롯 생성 (단건 or 배열, 'scheduled' 중복은 멱등 skip)
// DELETE /api/schedule/slots?year=2026&month=5 → 월 전체 초기화

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createSlotsIdempotent } from '@/lib/schedule/create-slots';

const VALID_CHANNELS = ['blog', 'naver_cafe', 'facebook', 'instagram'] as const;
const VALID_STATUSES = ['scheduled', 'publishing', 'published', 'failed', 'cancelled'] as const;
const VALID_MODES = ['manual', 'ai_auto'] as const;

const SlotSchema = z.object({
  content_id: z.string().nullish(),
  contentId: z.string().nullish(),
  channel: z.enum(VALID_CHANNELS),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(VALID_STATUSES).default('scheduled'),
  mode: z.enum(VALID_MODES).default('manual'),
}).refine(
  (d) => d.scheduled_at || d.scheduledAt,
  { message: 'scheduled_at 또는 scheduledAt 필수' },
);

const CreateSlotsSchema = z.union([
  SlotSchema,
  z.array(SlotSchema).min(1).max(100),
]);

/* Prisma returns camelCase; frontend expects snake_case */
function toSnake(row: Record<string, unknown>) {
  return {
    id:           row.id,
    content_id:   row.contentId ?? null,
    channel:      row.channel,
    scheduled_at: row.scheduledAt,
    published_at: row.publishedAt ?? null,
    status:       row.status,
    mode:         row.mode,
    external_id:  row.externalId ?? null,
    external_url: row.externalUrl ?? null,
    retry_count:  row.retryCount ?? 0,
    last_error:   row.lastError ?? null,
    created_at:   row.createdAt,
    content:      row.content ?? null,
  };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year');
  const month = searchParams.get('month');

  try {
    const where: Record<string, unknown> = { ownerId };

    if (year && month) {
      const y = Number(year), m = Number(month);
      const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const to = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00Z`);
      where.scheduledAt = { gte: from, lt: to };
    }

    const rows = await prisma.scheduleSlot.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: { content: { select: { topic: true } } },
    });

    const data = rows.map((r) => toSnake(r as unknown as Record<string, unknown>));
    return NextResponse.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;
  try {
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ data: null, error: 'JSON 파싱 실패' }, { status: 400 });
    }

    const parsed = CreateSlotsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ data: null, error: parsed.error.issues[0].message }, { status: 400 });
    }

    const rows = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const inputs = rows.map((row) => ({
      contentId:   row.content_id ?? row.contentId ?? null,
      channel:     row.channel,
      scheduledAt: new Date((row.scheduled_at ?? row.scheduledAt)!),
      status:      row.status,
      mode:        row.mode,
    }));

    // 참조 콘텐츠는 본인 소유만 허용 (타인 콘텐츠 id 로 슬롯 생성 차단)
    const contentIds = [...new Set(inputs.map((r) => r.contentId).filter((id): id is string => !!id))];
    if (contentIds.length > 0) {
      const owned = await prisma.content.count({ where: { ownerId, id: { in: contentIds } } });
      if (owned !== contentIds.length) {
        return NextResponse.json({ data: null, error: '콘텐츠를 찾을 수 없습니다' }, { status: 404 });
      }
    }

    // 멱등 생성(중복 'scheduled' 슬롯 skip + owner 단위 직렬화) — lib/schedule/create-slots.ts
    const { created, skipped } = await createSlotsIdempotent(prisma, ownerId, inputs);

    // 응답 data = 새로 만든 슬롯만 (기존 계약 유지). skipped = 중복이라 건너뛴 건수(추가 필드)
    const data = created.map((r) => toSnake(r as unknown as Record<string, unknown>));
    return NextResponse.json({ data, skipped, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year');
  const month = searchParams.get('month');

  if (!year || !month) {
    return NextResponse.json({ data: null, error: 'year, month 필수' }, { status: 400 });
  }

  try {
    const y = Number(year), m = Number(month);
    const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const to = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00Z`);

    await prisma.scheduleSlot.deleteMany({
      where: {
        ownerId,
        scheduledAt: { gte: from, lt: to },
      },
    });

    return NextResponse.json({ data: null, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
