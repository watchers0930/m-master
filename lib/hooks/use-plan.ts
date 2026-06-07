'use client';

import { useState, useEffect } from 'react';

export type PlanKey = 'free' | 'starter' | 'pro';

interface PlanState {
  plan: PlanKey;
  loading: boolean;
}

/** 현재 유저의 플랜을 /api/billing/usage에서 가져옴 */
export function usePlan(): PlanState {
  const [state, setState] = useState<PlanState>({ plan: 'free', loading: true });

  useEffect(() => {
    fetch('/api/billing/usage')
      .then((r) => r.json())
      .then((res) => {
        const plan = (res.data?.plan ?? 'free') as PlanKey;
        setState({ plan, loading: false });
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, []);

  return state;
}

/** 기능별 최소 요구 플랜 */
export const FEATURE_MIN_PLAN: Record<string, PlanKey> = {
  rag: 'starter',
  abTest: 'pro',
};

const PLAN_RANK: Record<PlanKey, number> = { free: 0, starter: 1, pro: 2 };

/** 현재 플랜으로 해당 기능 사용 가능 여부 */
export function canAccessFeature(plan: PlanKey, feature: string): boolean {
  const minPlan = FEATURE_MIN_PLAN[feature];
  if (!minPlan) return true;
  return PLAN_RANK[plan] >= PLAN_RANK[minPlan];
}
