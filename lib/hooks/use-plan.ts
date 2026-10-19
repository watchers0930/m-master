'use client';

import { useState, useEffect, useCallback } from 'react';

export type PlanKey = 'free' | 'starter' | 'pro';

interface PlanState {
  plan: PlanKey;
  loading: boolean;
  /** 플랜 조회 실패 여부. 실패를 'free'로 오인하지 않도록 호출부에서 분기한다. */
  error: boolean;
}

export interface UsePlanResult extends PlanState {
  /** 플랜 재조회 (조회 실패 시 재시도용) */
  refetch: () => void;
}

/** 현재 유저의 플랜을 /api/billing/usage에서 가져옴 */
export function usePlan(): UsePlanResult {
  const [state, setState] = useState<PlanState>({ plan: 'free', loading: true, error: false });

  const load = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch('/api/billing/usage')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((res) => {
        if (!alive) return;
        const plan = (res.data?.plan ?? 'free') as PlanKey;
        setState({ plan, loading: false, error: false });
      })
      .catch(() => {
        if (!alive) return;
        // 조회 실패: 기본값 free 로 두되 error=true 로 표시해 호출부가 구분할 수 있게 한다.
        setState({ plan: 'free', loading: false, error: true });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  return { ...state, refetch: load };
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
