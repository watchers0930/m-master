import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/visibility/http';
import { invalidateGa4Credentials } from '@/lib/ga4/auth';
import type { z } from 'zod';
import type { settingsSchema } from '@/schemas/settings';
export async function getSettings(ownerId: string) {
  const s = await prisma.setting.findUnique({ where: { ownerId }, select: {
    brandGuide: true, promptTemplates: true, budgetMonthly: true, alertThreshold: true,
    notifications: true, automationDomainId: true,
  } });
  return { brand_guide: s?.brandGuide ?? {}, prompt_templates: s?.promptTemplates ?? {},
    budget_monthly: s?.budgetMonthly ?? 500000, alert_threshold: s?.alertThreshold ?? 0.8,
    notifications: s?.notifications ?? { publish_success: true, low_score: true, ai_schedule_complete: true,
      performance_spike: false, budget_80pct: true }, automation_domain_id: s?.automationDomainId ?? null };
}
export async function saveSettings(ownerId: string, input: z.infer<typeof settingsSchema>) {
  await prisma.$transaction(async tx => {
    if (input.automation_domain_id && !await tx.domain.findFirst({ where: { id: input.automation_domain_id, ownerId }, select: { id: true } })) notFound();
    const data = { brandGuide: input.brand_guide, promptTemplates: input.prompt_templates,
      budgetMonthly: input.budget_monthly, alertThreshold: input.alert_threshold,
      notifications: input.notifications, automationDomainId: input.automation_domain_id };
    await tx.setting.upsert({ where: { ownerId }, create: { ownerId, ...data }, update: data });
  });
}
export async function ga4Settings(ownerId: string) {
  const [credential, bindings, setting] = await Promise.all([
    prisma.channelCredential.findUnique({ where: { ownerId_channel: { ownerId, channel: 'ga4' } }, select: { updatedAt: true, refreshToken: true } }),
    prisma.ga4Binding.findMany({ where: { ownerId }, select: { domainId: true, host: true, propertyId: true,
      status: true, lastCheckedAt: true, lastErrorCode: true }, orderBy: { id: 'asc' }, take: 100 }),
    prisma.setting.findUnique({ where: { ownerId }, select: { automationDomainId: true } }),
  ]);
  return { connected_oauth: !!credential?.refreshToken, oauth_updated_at: credential?.updatedAt ?? null,
    bindings: bindings.map(b => ({ domain_id: b.domainId, host: b.host, property_id: b.propertyId,
      status: b.status, last_checked_at: b.lastCheckedAt, last_error_code: b.lastErrorCode })),
    automation_domain_id: setting?.automationDomainId ?? null };
}
export async function disconnectGa4(ownerId: string) {
  await prisma.channelCredential.deleteMany({ where: { ownerId, channel: 'ga4' } });
  invalidateGa4Credentials(ownerId);
}
