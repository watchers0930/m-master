import { prisma } from '@/lib/prisma';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import { CredentialCryptoError } from '@/lib/crypto/credentials';
import { invalidateGa4Credentials } from '@/lib/ga4/auth';
import { credentialPresence, deleteChannelCredential } from '@/lib/credentials/store';
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
    credentialPresence(ownerId, 'ga4'), // 값은 반환하지 않음. 복호화 실패는 error로 구분
    prisma.ga4Binding.findMany({ where: { ownerId }, select: { domainId: true, host: true, propertyId: true,
      status: true, lastCheckedAt: true, lastErrorCode: true }, orderBy: { id: 'asc' }, take: 100 }),
    prisma.setting.findUnique({ where: { ownerId }, select: { automationDomainId: true } }),
  ]);
  // 복호화 실패는 '연결됨'이 아니라 관리자 설정 오류로 표시한다. 재연결·해제로 복구 가능한지는 recoverable(런타임 키 = DB 앵커)로 판정.
  return { connected_oauth: !!credential?.hasRefreshToken && !credential.error, oauth_updated_at: credential?.updatedAt ?? null,
    oauth_error: credential?.error ? 'credential_storage_error' as const : null,
    // 사유 코드(not_configured=운영 env 문제 / key_mismatch·invalid_blob=저장 행 문제)만 — 화면이 복구 버튼을 고른다
    oauth_error_reason: credential?.error ? credential.reason : null,
    oauth_error_recoverable: !!credential?.error && credential.recoverable,
    bindings: bindings.map(b => ({ domain_id: b.domainId, host: b.host, property_id: b.propertyId,
      status: b.status, last_checked_at: b.lastCheckedAt, last_error_code: b.lastErrorCode })),
    automation_domain_id: setting?.automationDomainId ?? null };
}
// 삭제도 정본 키 환경(런타임 kid == 앵커)에서만 — 거부는 채널 저장·삭제와 같은 503 credential_storage_unavailable(값·원문 없음)
export async function disconnectGa4(ownerId: string) {
  try { await deleteChannelCredential(ownerId, 'ga4'); }
  catch (error) {
    if (!(error instanceof CredentialCryptoError)) throw error;
    console.error('[credentials] delete failed', { channel: 'ga4', reason: error.reason });
    throw new VisibilityError('credential_storage_unavailable', '자격증명을 안전하게 변경할 수 없습니다. 관리자에게 문의하세요.', 503);
  }
  invalidateGa4Credentials(ownerId);
}
