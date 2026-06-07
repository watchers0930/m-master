// app/api/cafe-targets/route.ts — 카페 타겟 CRUD
// GET  → 전체 목록
// POST → 추가 { name, clubId, menuId }
// PUT  → 수정 { id, name?, clubId?, menuId? }
// PATCH → 기본 카페 변경 { id, isDefault }
// DELETE → 삭제 { id }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkChannelLimit, getUserPlan } from '@/lib/billing/limits';

const CreateSchema = z.object({
  name: z.string().min(1, '카페 이름은 필수입니다'),
  clubId: z.string().min(1, '카페 ID는 필수입니다'),
  menuId: z.string().min(1, '메뉴 ID는 필수입니다'),
});

const PatchSchema = z.object({
  id: z.string().min(1),
  isDefault: z.boolean(),
});

const UpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, '카페 이름은 필수입니다').optional(),
  clubId: z.string().min(1, '카페 ID는 필수입니다').optional(),
  menuId: z.string().min(1, '메뉴 ID는 필수입니다').optional(),
}).refine(d => d.name || d.clubId || d.menuId, { message: '수정할 항목이 없습니다' });

const DeleteSchema = z.object({
  id: z.string().min(1),
});

// ── GET — 전체 목록 ──
export async function GET() {
  const session = await requireSession();
  const ownerId = session.user.id;
  const targets = await prisma.cafeTarget.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ data: targets, error: null });
}

// ── POST — 추가 ──
export async function POST(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { name, clubId, menuId } = parsed.data;

  // 채널 수 제한 체크
  const plan = await getUserPlan(ownerId);
  try {
    await checkChannelLimit(ownerId, plan);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'plan_limit', message: err instanceof Error ? err.message : '채널 한도 초과' } },
      { status: 429 },
    );
  }

  // 첫 번째 타겟이면 자동으로 기본 설정
  const count = await prisma.cafeTarget.count({ where: { ownerId } });
  const target = await prisma.cafeTarget.create({
    data: { ownerId, name, clubId, menuId, isDefault: count === 0 },
  });

  return NextResponse.json({ data: target, error: null });
}

// ── PUT — 수정 ──
export async function PUT(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { id, ...fields } = parsed.data;

  // 소유권 확인
  const existing = await prisma.cafeTarget.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== ownerId) {
    return NextResponse.json({ error: { code: 'not_found', message: '대상을 찾을 수 없습니다' } }, { status: 404 });
  }

  const data: Record<string, string> = {};
  if (fields.name) data.name = fields.name;
  if (fields.clubId) data.clubId = fields.clubId;
  if (fields.menuId) data.menuId = fields.menuId;

  const target = await prisma.cafeTarget.update({ where: { id }, data });
  return NextResponse.json({ data: target, error: null });
}

// ── PATCH — 기본 카페 변경 ──
export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { id, isDefault } = parsed.data;

  // 소유권 확인
  const existing = await prisma.cafeTarget.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== ownerId) {
    return NextResponse.json({ error: { code: 'not_found', message: '대상을 찾을 수 없습니다' } }, { status: 404 });
  }

  if (isDefault) {
    // 기존 기본 해제 후 새 기본 설정 (본인 소유만)
    await prisma.$transaction([
      prisma.cafeTarget.updateMany({ where: { ownerId, isDefault: true }, data: { isDefault: false } }),
      prisma.cafeTarget.update({ where: { id }, data: { isDefault: true } }),
    ]);
  } else {
    await prisma.cafeTarget.update({ where: { id }, data: { isDefault: false } });
  }

  const targets = await prisma.cafeTarget.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ data: targets, error: null });
}

// ── DELETE — 삭제 ──
export async function DELETE(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  // 소유권 확인
  const existing = await prisma.cafeTarget.findUnique({ where: { id: parsed.data.id } });
  if (!existing || existing.ownerId !== ownerId) {
    return NextResponse.json({ error: { code: 'not_found', message: '대상을 찾을 수 없습니다' } }, { status: 404 });
  }

  await prisma.cafeTarget.delete({ where: { id: parsed.data.id } });
  return NextResponse.json({ data: { deleted: true }, error: null });
}
