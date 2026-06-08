// GET /api/settings — 유저 설정 조회
// PUT /api/settings — 유저 설정 저장

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await requireSession();
  const ownerId = session.user.id;

  const setting = await prisma.setting.findUnique({ where: { ownerId } });

  return NextResponse.json({
    data: {
      brand_guide: (setting?.brandGuide ?? {}) as Record<string, unknown>,
      prompt_templates: (setting?.promptTemplates ?? {}) as Record<string, unknown>,
      budget_monthly: setting?.budgetMonthly ?? 500000,
      alert_threshold: setting?.alertThreshold ?? 0.8,
      notifications: (setting?.notifications ?? {
        publish_success: true,
        low_score: true,
        ai_schedule_complete: true,
        performance_spike: false,
        budget_80pct: true,
      }) as Record<string, unknown>,
    },
    error: null,
  });
}

export async function PUT(req: Request) {
  const session = await requireSession();
  const ownerId = session.user.id;
  const body = await req.json();

  await prisma.setting.upsert({
    where: { ownerId },
    create: {
      ownerId,
      brandGuide: body.brand_guide ?? {},
      promptTemplates: body.prompt_templates ?? {},
      budgetMonthly: body.budget_monthly ?? 500000,
      alertThreshold: body.alert_threshold ?? 0.8,
      notifications: body.notifications ?? {},
    },
    update: {
      brandGuide: body.brand_guide ?? undefined,
      promptTemplates: body.prompt_templates ?? undefined,
      budgetMonthly: body.budget_monthly ?? undefined,
      alertThreshold: body.alert_threshold ?? undefined,
      notifications: body.notifications ?? undefined,
    },
  });

  return NextResponse.json({ data: null, error: null });
}
