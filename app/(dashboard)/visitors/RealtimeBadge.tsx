'use client';

import { useEffect, useState } from 'react';

export function RealtimeBadge() {
  const [users, setUsers] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/visitors/realtime', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setUsers(j.activeUsers ?? 0);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'var(--green-100)',
        border: '1px solid #bbf7d0',
        color: '#166534',
        fontSize: 11,
        fontWeight: 600,
      }}
      aria-live="polite"
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#22c55e',
          animation: 'rt-pulse 1.4s infinite',
        }}
      />
      <style>{`@keyframes rt-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      실시간 {users ?? '·'}명
    </div>
  );
}
