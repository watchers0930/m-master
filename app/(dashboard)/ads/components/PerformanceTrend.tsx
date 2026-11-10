// app/(dashboard)/ads/components/PerformanceTrend.tsx
// 7/30일 추이(Task 12): 날짜별 비용 막대(30일 창, 성과 행 있는 날만) + 7일·30일 합계. 성과는 매일 KST 06:00에 최근 7일을 다시 모은다.
'use client';

import type { AdOverviewDTO, AdPerfTotals } from '@/types/ads';
import { costPerSignup, ctr, formatCount, formatKrw } from '@/lib/api/ads-format';
import { Card, Empty, subText } from './ui';

function Totals({ label, t }: { label: string; t: AdPerfTotals }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', background: 'var(--n50)', borderRadius: 8, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sub)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>비용 {formatKrw(t.costKrw)} · 노출 {formatCount(t.impCnt)} · 클릭 {formatCount(t.clkCnt)} · 클릭률 {ctr(t.clkCnt, t.impCnt)}</span>
      <span style={{ fontSize: 12, color: 'var(--sub)' }}>가입 전환 {formatCount(t.ccnt)}건 · 가입당 비용 {costPerSignup(t.costKrw, t.ccnt)}</span>
    </div>
  );
}

export function PerformanceTrend({ performance }: { performance: AdOverviewDTO['performance'] }) {
  const max = Math.max(1, ...performance.daily.map((d) => d.costKrw));
  return (
    <Card title="7/30일 추이" right={<span style={subText}>비용 = 네이버 salesAmt(VAT 별도)</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <Totals label={`최근 7일 (${performance.since7}~)`} t={performance.totals7} />
        <Totals label={`최근 30일 (${performance.since30}~)`} t={performance.totals30} />
      </div>
      {performance.daily.length === 0 ? (
        <Empty>아직 수집된 성과가 없습니다. 매일 오전 6시(KST)에 최근 7일 성과를 모읍니다.</Empty>
      ) : (
        <div role="img" aria-label="날짜별 광고 비용" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '10px 0 0' }}>
          {performance.daily.map((d) => (
            <div key={d.date} title={`${d.date} · ${formatKrw(d.costKrw)} · 클릭 ${formatCount(d.clkCnt)}`}
              style={{ flex: 1, minWidth: 6, height: `${Math.max(2, (d.costKrw / max) * 100)}%`, background: d.date >= performance.since7 ? 'var(--blue-400)' : 'var(--blue-200)', borderRadius: '3px 3px 0 0' }} />
          ))}
        </div>
      )}
    </Card>
  );
}
