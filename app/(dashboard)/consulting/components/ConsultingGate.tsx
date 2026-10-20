// app/(dashboard)/consulting/components/ConsultingGate.tsx
// 마케팅 컨설팅 기능 플랜 게이트 (UX용 — 서버가 403 feature_forbidden / plan_limit 로 최종 강제).
// 설계 §6.3: FEATURE_MIN_PLAN.consulting='starter'. 조회(본인 이력)는 플랜 무관 허용,
// 과금을 유발하는 생성(POST)만 canWrite(starter+) 게이트. 플랜 조회 실패는 free 로 오인하지 않는다.
'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { usePlan, type PlanKey } from '@/lib/hooks/use-plan';

const PLAN_LABELS: Record<PlanKey, string> = { free: 'Free', starter: 'Starter', pro: 'Pro' };
const RANK: Record<PlanKey, number> = { free: 0, starter: 1, pro: 2 };

export interface ConsultingAccess {
  plan: PlanKey;
  /** 전략 생성(유료 GPT 호출)을 유발하는 쓰기 허용 여부(starter+). */
  canWrite: boolean;
}

const AccessContext = createContext<ConsultingAccess>({ plan: 'free', canWrite: false });

export function useConsultingAccess(): ConsultingAccess {
  return useContext(AccessContext);
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '56px 0' }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
    </div>
  );
}

function UpgradeBanner({ plan }: { plan: PlanKey }) {
  return (
    <div className="card" role="note" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--amber-700)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <div style={{ flex: 1, minWidth: 180 }}>
        <p style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
          저장 SEO·GEO 기반 전략 리포트 생성은 <strong>Starter</strong> 플랜부터 사용할 수 있습니다. GA4 성과 분석은 현재 포함되지 않습니다.
        </p>
        <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
          이미 생성된 리포트 조회는 현재 플랜({PLAN_LABELS[plan]})에서도 계속 가능합니다.
        </p>
      </div>
      <Link href="/billing" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, background: 'var(--blue-500)', color: '#fff', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
        플랜 업그레이드
      </Link>
    </div>
  );
}

export function ConsultingGate({ children }: { children: ReactNode }) {
  const { plan, loading, error, refetch } = usePlan();

  if (loading) return <Spinner />;

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '44px 20px' }}>
        <p style={{ fontSize: 12.5, color: '#dc2626' }}>플랜 정보를 불러오지 못했습니다.</p>
        <p style={{ fontSize: 11.5, color: 'var(--sub)', marginTop: 4 }}>잠시 후 다시 시도해 주세요.</p>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={refetch}>다시 시도</button>
      </div>
    );
  }

  const canWrite = RANK[plan] >= RANK.starter;

  return (
    <AccessContext.Provider value={{ plan, canWrite }}>
      {!canWrite && <UpgradeBanner plan={plan} />}
      {children}
    </AccessContext.Provider>
  );
}
