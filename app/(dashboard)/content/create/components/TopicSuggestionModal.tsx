'use client';

import React, { useEffect, useState } from 'react';
import type { TopicRecommendation } from '@/types/db';

interface TopicTag { label: string; type: 's' | 'e' | 't' }
interface TopicFactors { tags?: TopicTag[]; reason?: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (topic: string) => void;
}

const tagBg: Record<TopicTag['type'], { bg: string; color: string }> = {
  s: { bg: 'var(--blue-50)', color: 'var(--blue-700)' },
  e: { bg: '#fef3c7', color: '#92400e' },
  t: { bg: '#dcfce7', color: '#166534' },
};

export function TopicSuggestionModal({ open, onClose, onSelect }: Props) {
  const [items, setItems] = useState<TopicRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/topics', { cache: 'no-store' });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json?.error?.message ?? '추천 토픽을 불러오지 못했습니다');
          return;
        }
        setItems((json.items ?? []) as TopicRecommendation[]);
      } catch {
        if (!cancelled) setError('네트워크 오류');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div onClick={onClose} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 440,
        background: 'var(--surface, #fff)', borderRadius: 12,
        boxShadow: '0 4px 32px rgba(30,58,95,.18)',
        fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/><polyline points="17,6 23,6 23,12"/>
            </svg>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>이달 추천 토픽 TOP 5</h2>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sub)', padding: 0, lineHeight: 1 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div style={{ padding: 12, maxHeight: '60vh', overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--sub)', fontSize: 12 }}>불러오는 중...</div>
          )}
          {!loading && error && (
            <div style={{ padding: '24px 8px', textAlign: 'center', color: '#ef4444', fontSize: 12 }}>{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--sub)', fontSize: 12, lineHeight: 1.6 }}>
              아직 추천이 없습니다.<br/>대시보드에서 갱신 버튼을 눌러 추천을 생성하세요.
            </div>
          )}
          {!loading && !error && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((item, idx) => {
                const factors = (item.factors as TopicFactors | null) ?? {};
                const tags = factors.tags ?? [];
                const reason = factors.reason;
                const rank = idx + 1;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { onSelect(item.topic); onClose(); }}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--surface)',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--blue-500)'; e.currentTarget.style.background = 'var(--blue-50)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                  >
                    <div style={{
                      flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                      background: rank === 1 ? 'var(--blue-500)' : rank === 2 ? 'var(--blue-200)' : 'var(--n100, #e2e8f0)',
                      color: rank <= 2 ? '#fff' : 'var(--sub)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                    }}>{rank}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{item.topic}</div>
                      {tags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: reason ? 4 : 0 }}>
                          {tags.map(({ label, type }) => {
                            const c = tagBg[type] ?? tagBg.s;
                            return (
                              <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: c.bg, color: c.color }}>{label}</span>
                            );
                          })}
                        </div>
                      )}
                      {reason && (
                        <div style={{ fontSize: 10.5, color: 'var(--sub)', lineHeight: 1.4 }}>{reason}</div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-700)' }}>{Math.round(item.score)}</div>
                      <div style={{ fontSize: 9, color: 'var(--sub)' }}>점수</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
