import { VisibilityError } from '@/lib/visibility/errors';
/**
 * 자동화 비상 정지 스위치(env PIPELINE_AUTOMATION_ENABLED)의 유일한 판정 지점.
 * cron 라우트(lib/pipeline/http.ts)와 블로그 작업자 pending·verify(lib/publish/worker-auth.ts)가 함께 쓴다.
 * 'true'가 아니면 모두 정지(fail-closed).
 */
export function automationEnabled() {
  return process.env.PIPELINE_AUTOMATION_ENABLED === 'true';
}
export function assertAutomationEnabled() {
  if (!automationEnabled()) throw new VisibilityError('automation_paused', '자동화가 정지되어 있습니다.', 503);
}
