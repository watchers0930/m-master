// app/api/cafe-targets/route.ts — 카페 타겟 CRUD
// GET  → 전체 목록
// POST → 추가 { name, clubId, menuId }
// PATCH → 기본 카페 변경 { id, isDefault }
// DELETE → 삭제 { id }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const CreateSchema = z.object({
  name: z.string().min(1, '카페 이름은 필수입니다'),
  clubId: z.string().min(1, '카페 ID는 필수입니다'),
  menuId: z.string().min(1, '메뉴 ID는 필수입니다'),
});

const PatchSchema = z.object({
  id: z.string().min(1),
  isDefault: z.boolean(),
});

const DeleteSchema = z.object({
  id: z.string().min(1),
});

// ── GET — 전체 목록 ──
export async function GET() {
  await requireSession();
  const targets = await prisma.cafeTarget.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ data: targets, error: null });
}

// ── POST — 추가 ──
export async function POST(request: NextRequest) {
  await requireSession();

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

  // 첫 번째 타겟이면 자동으로 기본 설정
  const count = await prisma.cafeTarget.count();
  const target = await prisma.cafeTarget.create({
    data: { name, clubId, menuId, isDefault: count === 0 },
  });

  return NextResponse.json({ data: target, error: null });
}

// ── PATCH — 기본 카페 변경 ──
export async function PATCH(request: NextRequest) {
  await requireSession();

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

  if (isDefault) {
    // 기존 기본 해제 후 새 기본 설정
    await prisma.$transaction([
      prisma.cafeTarget.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.cafeTarget.update({ where: { id }, data: { isDefault: true } }),
    ]);
  } else {
    await prisma.cafeTarget.update({ where: { id }, data: { isDefault: false } });
  }

  const targets = await prisma.cafeTarget.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ data: targets, error: null });
}

// ── DELETE — 삭제 ──
export async function DELETE(request: NextRequest) {
  await requireSession();

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

  await prisma.cafeTarget.delete({ where: { id: parsed.data.id } });
  return NextResponse.json({ data: { deleted: true }, error: null });
}
