'use client';

import Link from 'next/link';
import { usePlan, canAccessFeature, FEATURE_MIN_PLAN, type PlanKey } from '@/lib/hooks/use-plan';
import type { ReactNode } from 'react';

interface PlanGateProps {
  feature: string;           // 'rag' | 'abTest'
  children: ReactNode;
  fallbackMessage?: string;  // 커스텀 메시지
}

const PLAN_LABELS: Record<PlanKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
};

/**
 * 플랜 기반 기능 게이트.
 * 해당 기능에 접근 불가하면 업그레이드 안내를 표시.
 */
export function PlanGate({ feature, children, fallbackMessage }: PlanGateProps) {
  const { plan, loading } = usePlan();

  if (loading) return null;
  if (canAccessFeature(plan, feature)) return <>{children}</>;

  const minPlan = FEATURE_MIN_PLAN[feature] ?? 'starter';
  const message = fallbackMessage ?? `이 기능은 ${PLAN_LABELS[minPlan]} 플랜부터 사용할 수 있습니다.`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 14, padding: '56px 20px', textAlign: 'center',
    }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--n200)" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
      <p style={{ fontSize: 13, color: 'var(--sub)', maxWidth: 320 }}>{message}</p>
      <p style={{ fontSize: 11.5, color: 'var(--sub)' }}>
        현재 플랜: <strong>{PLAN_LABELS[plan]}</strong>
      </p>
      <Link
        href="/billing"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 20px', borderRadius: 7,
          background: 'var(--blue-500)', color: '#fff', border: 'none',
          fontSize: 12, fontWeight: 600, textDecoration: 'none',
        }}
      >
        플랜 업그레이드
      </Link>
    </div>
  );
}
