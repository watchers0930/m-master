'use client';

// 실시간 활성 사용자 배지 (GET /api/visitors/realtime → Ga4Block, 설계 §2.5).
// 연결 오류·미연결이면 0명이 아니라 상태 문구를 보여준다.
// 실시간 API 는 hostName 으로 나눌 수 없어 같은 웹 스트림을 쓰는 모든 host 합계다 → '스트림 전체 기준' 표기.
// scope_level 이 아직 내려오지 않는 서버에서도 실시간은 스트림 단위이므로 'host' 로 명시된 경우만 표기를 생략한다.

import { useRealtimeVisitors } from '@/hooks/useVisitorsData';
import { ga4FailureText } from '@/lib/analytics/ga4-block-text';

export function RealtimeBadge({ domainId }: { domainId: string | null }) {
  const { data: block, isError } = useRealtimeVisitors(domainId);
  const ok = block?.state === 'ok' ? block.data : null;
  const failText = block && block.state !== 'ok' ? ga4FailureText(block) : isError ? '실시간 조회 실패' : null;
  const streamLevel = !failText && block?.state === 'ok' && block.scope_level !== 'host';

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
      {streamLevel && (
        <span
          style={{ fontSize: 12, fontWeight: 500, color: 'var(--sub)', marginLeft: 4 }}
          title="GA4 실시간 지표는 도메인(host)별로 나눌 수 없어, 같은 웹 스트림을 쓰는 모든 도메인의 합계입니다"
        >
          스트림 전체 기준
        </span>
      )}
    </div>
  );
}
