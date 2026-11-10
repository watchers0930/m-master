// app/(dashboard)/ads/components/ui.tsx
// 광고 화면 공용 표시 조각(Task 12) — 기존 대시보드 카드(.card/.card-head)·버튼(.btn) 패턴. 여백은 gap/padding(최소 10px), 글자는 12px 이상.
'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ErrorView } from '@/lib/api/ads-format';
import { lockLabel, type LockTone } from '@/lib/api/ads-format';
import type { AlertBadge } from '@/lib/api/ads-safety';

export function Card({ title, right, children, bodyStyle }: { title: string; right?: ReactNode; children: ReactNode; bodyStyle?: CSSProperties }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{title}</span>
        {right}
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, ...bodyStyle }}>{children}</div>
    </div>
  );
}

/** 오류·안내. urgent = 대장이 지금 네이버 화면에서 조치해야 함(크게, 붉게). */
export function Notice({ view, tone }: { view?: ErrorView | null; tone?: 'info' | 'ok' | 'warn' | 'error' }) {
  if (!view) return null;
  const t = view.urgent ? 'urgent' : tone ?? 'error';
  const palette: Record<string, CSSProperties> = {
    urgent: { background: '#fee2e2', color: '#991b1b', border: '2px solid #dc2626', fontSize: 14, fontWeight: 700 },
    error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: 13 },
    warn: { background: 'var(--amber-100)', color: 'var(--amber-700)', border: '1px solid #fcd34d', fontSize: 13 },
    ok: { background: 'var(--green-100)', color: 'var(--green-700)', border: '1px solid #86efac', fontSize: 13 },
    info: { background: 'var(--blue-50)', color: 'var(--blue-600)', border: '1px solid var(--blue-200)', fontSize: 13 },
  };
  return (
    <div role={t === 'urgent' || t === 'error' ? 'alert' : 'status'} style={{ borderRadius: 8, padding: '10px 14px', lineHeight: 1.55, ...palette[t] }}>
      {view.message}
    </div>
  );
}

/** 안내 문구(오류 아님). */
export const info = (message: string): ErrorView => ({ message, urgent: false, reload: false });

const TONE: Record<LockTone, CSSProperties> = {
  on: { background: 'var(--green-100)', color: 'var(--green-700)' },
  off: { background: 'var(--n100)', color: 'var(--n500)' },
  guard: { background: 'var(--amber-100)', color: 'var(--amber-700)' },
  pending: { background: 'var(--blue-50)', color: 'var(--blue-500)' },
  danger: { background: '#fee2e2', color: '#991b1b', border: '1px solid #dc2626' },
};

/** pauseUnconfirmed: 켜짐 기록인데 끄기가 확인되지 않음 → 녹색 '켜짐' 대신 붉은 경고(최종 판정 B1). */
export function LockBadge({ userLock, lockedBy, pauseUnconfirmed = false }: { userLock: boolean; lockedBy: string | null; pauseUnconfirmed?: boolean }) {
  const l = lockLabel(userLock, lockedBy, pauseUnconfirmed);
  return <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 4, padding: '2px 8px', whiteSpace: l.tone === 'danger' ? 'normal' : 'nowrap', ...TONE[l.tone] }}>{l.text}</span>;
}

/** 엔티티별 경보 꼬리표(드리프트·검수 반려·끄기 미확인). */
export function AlertTags({ badges }: { badges?: AlertBadge[] }) {
  if (!badges?.length) return null;
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {badges.map((b) => (
        <span key={b.text} style={{ fontSize: 12, fontWeight: 700, borderRadius: 4, padding: '2px 8px', ...(b.urgent ? TONE.danger : TONE.guard) }}>{b.text}</span>
      ))}
    </span>
  );
}

export const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
export const thStyle: CSSProperties = { padding: '8px 10px', textAlign: 'left', color: 'var(--sub)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' };
export const tdStyle: CSSProperties = { padding: '8px 10px', borderTop: '1px solid var(--border2)', color: 'var(--text)', verticalAlign: 'top' };
export const numStyle: CSSProperties = { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' };
export const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)',
  color: 'var(--text)', boxSizing: 'border-box',
};
export const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--sub)' };
export const subText: CSSProperties = { fontSize: 12, color: 'var(--sub)', lineHeight: 1.5 };

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ ...subText, textAlign: 'center', padding: '28px 16px' }}>{children}</div>;
}
