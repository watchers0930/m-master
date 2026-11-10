// app/(dashboard)/ads/components/AccountPicker.tsx
// 보고 있는 광고 계정 고르기(Task 12). 계정이 하나면 이름만 보인다. 연결 안 됨은 그대로 표시(오류 아님).
'use client';

import Link from 'next/link';
import type { AdAccountDTO } from '@/types/ads';
import { inputStyle } from './ui';

export function accountStatusText(a: AdAccountDTO): string {
  if (!a.connected) return '연결 안 됨';
  if (a.status === 'invalid_key') return '키 무효 — 새 키로 교체 필요';
  if (a.status === 'disconnecting') return '해제 진행 중';
  return `연결됨 · 키 끝 ${a.keyLast4}`;
}

export function AccountPicker({ accounts, selected, onSelect }: { accounts: AdAccountDTO[]; selected: AdAccountDTO | null; onSelect: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>광고 계정</span>
      {accounts.length > 1 ? (
        <select value={selected?.id ?? ''} onChange={(e) => onSelect(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: 220 }}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.naverCustomerId}) — {accountStatusText(a)}</option>)}
        </select>
      ) : selected ? (
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{selected.label} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--sub)' }}>{selected.naverCustomerId} · {accountStatusText(selected)}</span></span>
      ) : null}
      <Link href="/ads/accounts" prefetch={false} className="btn btn-ghost" style={{ marginLeft: 'auto' }}>계정 관리</Link>
    </div>
  );
}
