// app/(dashboard)/ads/components/StatusCards.tsx
// 계정 상태 카드(Task 12): 비즈머니 · 오늘 비용/하루 상한 · 30일 비용 · 가입당 비용. 값은 감시(30분 크론)의 마지막 관찰 — "n분 전 기준".
// 모르는 값(null)은 '확인 못 함'(0이 아니다). 전환 0이면 '전환 추적 준비 전(4-2)'.
'use client';

import type { AdOverviewDTO } from '@/types/ads';
import { capPercent, costPerSignup, formatCount, formatKrw, snapshotAgeLabel } from '@/lib/api/ads-format';

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--sub)' }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: warn ? '#b91c1c' : 'var(--text)', fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.45 }}>{sub}</span>}
    </div>
  );
}

export function StatusCards({ overview }: { overview: AdOverviewDTO }) {
  const { account, snapshot, performance } = overview;
  const pct = capPercent(snapshot.spendKrw, account.dailyCapKrw);
  const age = snapshotAgeLabel(snapshot.ageMinutes);
  const lowBizmoney = snapshot.bizmoneyKrw !== null && snapshot.bizmoneyKrw < account.dailyCapKrw * 3;
  const t30 = performance.totals30;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <Stat label="비즈머니" value={formatKrw(snapshot.bizmoneyKrw)} sub={`${age}${lowBizmoney ? ' · 하루 상한 3일치 미만' : ''}`} warn={lowBizmoney} />
      <Stat
        label="오늘 비용 / 하루 상한"
        value={`${formatKrw(snapshot.spendKrw)} / ${formatKrw(account.dailyCapKrw)}`}
        sub={`${pct === null ? '오늘 비용을 아직 확인하지 못했습니다' : `상한의 ${pct}%`} · ${age} · VAT 별도`}
        warn={pct !== null && pct >= 90}
      />
      <Stat label="최근 30일 비용" value={formatKrw(t30.costKrw)} sub={`노출 ${formatCount(t30.impCnt)} · 클릭 ${formatCount(t30.clkCnt)} · ${performance.since30}부터`} />
      <Stat label="가입 전환 · 가입당 비용(30일)" value={t30.ccnt > 0 ? `${formatCount(t30.ccnt)}건` : '—'} sub={costPerSignup(t30.costKrw, t30.ccnt)} />
    </div>
  );
}
