'use client';

// 실시간 활성 사용자 배지 (GET /api/visitors/realtime → Ga4Block, 설계 §2.5).
// 연결 오류·미연결이면 0명이 아니라 상태 문구를 보여준다.

import { useRealtimeVisitors } from '@/hooks/useVisitorsData';
import { ga4FailureText } from '@/components/ga4/Ga4BlockState';

export function RealtimeBadge({ domainId }: { domainId: string | null }) {
  const { data: block, isError } = useRealtimeVisitors(domainId);
  const ok = block?.state === 'ok' ? block.data : null;
  const failText = block && block.state !== 'ok' ? ga4FailureText(block) : isError ? '실시간 조회 실패' : null;

  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6,
        background: failText ? 'var(--n100)' : 'var(--green-100)',
        border: failText ? '1px solid var(--border)' : '1px solid #bbf7d0',
        color: failText ? 'var(--sub)' : '#166534', fontSize: 11, fontWeight: 600,
      }}
      aria-live="polite"
    >
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: failText ? '#9ca3af' : '#22c55e',
          animation: failText ? undefined : 'rt-pulse 1.4s infinite',
        }}
      />
      <style>{`@keyframes rt-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      {failText ? `실시간 · ${failText}` : `실시간 ${ok ? ok.active_users.toLocaleString() : '·'}명`}
    </div>
  );
}
