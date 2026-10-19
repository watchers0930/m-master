// app/(dashboard)/visibility/components/VisibilityGate.tsx
// AI 가시성 기능 플랜 게이트 (UX용 — 서버가 403 feature_forbidden 로 최종 강제).
// 설계 §3.3·§3.5·§3.6·§3.8·§4.7: 조회·질문 삭제·비활성화는 플랜과 무관하게 허용한다.
//   따라서 하향(Free) 사용자에게도 대시보드·질문 관리 화면을 그대로 보여주고,
//   생성·재활성·즉시 수집 같은 "쓰기" 작업만 플랜 제한을 건다(canWrite 컨텍스트로 전달).
// 플랜 조회 실패는 'free'로 오인해 화면을 막지 않고 별도 오류·재시도로 처리한다.
'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { usePlan, type PlanKey } from '@/lib/hooks/use-plan';

const PLAN_LABELS: Record<PlanKey, string> = { free: 'Free', starter: 'Starter', pro: 'Pro' };
const RANK: Record<PlanKey, number> = { free: 0, starter: 1, pro: 2 };

export interface VisibilityAccess {
  plan: PlanKey;
  /** 생성·재활성·즉시 수집 등 과금/수집을 유발하는 쓰기 작업 허용 여부(starter+). */
  canWrite: boolean;
}

const AccessContext = createContext<VisibilityAccess>({ plan: 'free', canWrite: false });

/** 자식 컴포넌트(QueryManager 등)가 쓰기 권한을 읽는 훅. */
export function useVisibilityAccess(): VisibilityAccess {
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

/** Free 등 쓰기 불가 플랜에게 보여주는 안내(조회·관리는 가능함을 함께 명시). */
function UpgradeBanner({ plan }: { plan: PlanKey }) {
  return (
    <div
      className="card"
      role="note"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--amber-700)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <div style={{ flex: 1, minWidth: 180 }}>
        <p style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
          질문 추가·재활성·즉시 수집은 <strong>Starter</strong> 플랜부터 사용할 수 있습니다.
        </p>
        <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
          기존 데이터 조회·질문 수정·삭제·비활성화는 현재 플랜({PLAN_LABELS[plan]})에서도 계속 가능합니다.
        </p>
      </div>
      <Link href="/billing" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, background: 'var(--blue-500)', color: '#fff', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
        플랜 업그레이드
      </Link>
    </div>
  );
}

export function VisibilityGate({ children }: { children: ReactNode }) {
  const { plan, loading, error, refetch } = usePlan();

  if (loading) return <Spinner />;

  // 플랜 조회 실패: free 로 오인해 화면을 막지 않고 재시도를 제공한다(설계 §4.7 조회는 플랜 무관).
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
