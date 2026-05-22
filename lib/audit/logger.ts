// lib/audit/logger.ts — audit_log 적재 (서버 전용)
// 모든 API Route에서 생성/발행/삭제 작업 후 반드시 호출

import { prisma } from '@/lib/prisma';
import type { JsonValue } from '@prisma/client/runtime/library';

export interface LogAuditOptions {
  actor: string | null;       // auth.uid() 또는 null(cron)
  action: string;             // 'rag.upload', 'content.generate', 'publish.blog' 등
  targetType?: string | null;
  targetId?: string | null;
  payload?: JsonValue;
}

export async function logAudit(options: LogAuditOptions): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor: options.actor,
        action: options.action,
        targetType: options.targetType ?? null,
        targetId: options.targetId ?? null,
        payload: options.payload ?? undefined,
      },
    });
  } catch (error) {
    // audit 실패는 메인 흐름 중단 불필요 — stderr 로그만
    console.error(
      '[audit/logger] auditLog insert 실패:',
      JSON.stringify(error),
    );
  }
}

// ----------------------------------------------------------------
// 공통 액션 상수 (오타 방지)
// ----------------------------------------------------------------
export const AUDIT_ACTIONS = {
  RAG_UPLOAD: 'rag.upload',
  RAG_INDEX: 'rag.index',
  RAG_DELETE: 'rag.delete',
  CONTENT_GENERATE: 'content.generate',
  PUBLISH_BLOG: 'publish.blog',
  PUBLISH_INSTAGRAM: 'publish.instagram',
  PUBLISH_FACEBOOK: 'publish.facebook',
  PUBLISH_NAVER_CAFE: 'publish.naver_cafe',
  SCHEDULE_CREATE: 'schedule.create',
  SCHEDULE_UPDATE: 'schedule.update',
  SCHEDULE_DELETE: 'schedule.delete',
  AB_TEST_CREATE: 'ab_test.create',
  AB_TEST_UPDATE: 'ab_test.update',
  AB_TEST_DELETE: 'ab_test.delete',
  AB_TEST_AUTO_COMPLETE: 'ab_test.auto_complete',
  CRON_CONTENT_GENERATE: 'cron.content_generate',
  CRON_SCHEDULE_PUBLISH: 'cron.schedule_publish',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
