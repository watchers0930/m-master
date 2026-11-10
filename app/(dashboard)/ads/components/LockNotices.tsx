// app/(dashboard)/ads/components/LockNotices.tsx
// 켜기·끄기 실패의 페이지 단위 배너(최종 판정 B2): 표 마지막 칸(가로 스크롤 안)에 묻히지 않게 페이지 맨 위에 띄운다.
// - LockButton이 push → 배너가 그 문구를 보이고, urgent면 배너로 스크롤·포커스를 옮긴다. 대장이 닫을 때까지 남는다.
// - Provider 밖(다른 화면에서 재사용)이면 usePageLockNotices()가 null → LockButton이 셀 안에 직접 보인다.
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ErrorView } from '@/lib/api/ads-format';
import { Notice } from './ui';

type Item = { id: number; label: string; view: ErrorView };
type Ctx = { items: Item[]; push: (label: string, view: ErrorView) => void; dismiss: (id: number) => void };
const LockNoticesContext = createContext<Ctx | null>(null);

export function LockNoticesProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const push = useCallback((label: string, view: ErrorView) => {
    seq.current += 1;
    const id = seq.current;
    setItems((prev) => [{ id, label, view }, ...prev].slice(0, 5));
  }, []);
  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ items, push, dismiss }), [items, push, dismiss]);
  return <LockNoticesContext.Provider value={value}>{children}</LockNoticesContext.Provider>;
}

export const usePageLockNotices = () => useContext(LockNoticesContext);

export function LockNoticeBanner() {
  const ctx = useContext(LockNoticesContext);
  const ref = useRef<HTMLDivElement>(null);
  const top = ctx?.items[0];
  useEffect(() => {
    if (top?.view.urgent && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      ref.current.focus();
    }
  }, [top?.id, top?.view.urgent]);
  if (!ctx || ctx.items.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} aria-live="assertive" style={{ display: 'flex', flexDirection: 'column', gap: 10, outline: 'none' }}>
      {ctx.items.map((x) => (
        <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}><Notice view={{ ...x.view, message: `${x.label}: ${x.view.message}` }} /></div>
          <button type="button" className="btn btn-ghost" onClick={() => ctx.dismiss(x.id)}>닫기</button>
        </div>
      ))}
    </div>
  );
}
