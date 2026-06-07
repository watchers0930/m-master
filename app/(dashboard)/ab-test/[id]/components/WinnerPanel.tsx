'use client';

import { useState } from 'react';
import type { AbTest, AbTestWinner } from '@/types/db';
import { updateAbTest } from '@/lib/api/ab-test';

interface Props {
  test: AbTest;
  onUpdated: (updated: AbTest) => void;
}

export default function WinnerPanel({ test, onUpdated }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  if (test.status !== 'completed') return null;

  const winner         = test.winner;
  const decidedBy      = test.winner_decided_by;
  const isManualNeeded = winner === 'tie' || decidedBy === 'manual' || !winner;

  const handleConfirm = async (w: AbTestWinner) => {
    setConfirming(true);
    setErrorMsg(null);

    const res = await updateAbTest(test.id, {
      action: 'confirm_winner',
      winner: w,
    });

    setConfirming(false);

    if (res.error) {
      setErrorMsg(res.error.message ?? '승자 확정에 실패했습니다');
    } else {
      onUpdated(res.data);
    }
  };

  // design.md §7 승자 표시 규칙
  const badgeStyle =
    decidedBy === 'auto' && winner !== 'tie'
      ? { bg: 'var(--green-100)',  color: 'var(--green-700)', label: '자동 확정' }
      : winner === 'tie'
      ? { bg: 'var(--amber-100)', color: 'var(--amber-700)', label: '동률 — 수동 확정 필요' }
      : { bg: 'var(--n100)',      color: 'var(--sub)',       label: '수동 확정' };

  const winnerLabel =
    winner === 'a'   ? '변형 A' :
    winner === 'b'   ? '변형 B' :
    winner === 'tie' ? '동률' : '미확정';

  const winnerBadgeBg =
    winner === 'a'   ? 'var(--blue-600)'  :
    winner === 'b'   ? 'var(--amber-500)' :
    'var(--n200)';

  const iconKind: 'tie' | 'manual' | 'auto' =
    winner === 'tie'       ? 'tie' :
    decidedBy === 'manual' ? 'manual' :
    'auto';

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">테스트 결과</span>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 10.5,
            fontWeight: 600,
            background: badgeStyle.bg,
            color: badgeStyle.color,
          }}
        >
          {badgeStyle.label}
        </span>
      </div>

      <div style={{ padding: '16px' }}>
        {/* 승자 표시 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{ color: badgeStyle.color }}>
            {iconKind === 'tie' ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 3v18M3 6l9 3 9-3M3 18l9-3 9 3"/>
              </svg>
            ) : iconKind === 'manual' ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M6 9H4a2 2 0 000 4h2M18 9h2a2 2 0 010 4h-2M12 17v3M8 20h8M7 9l5-6 5 6M7 9v4a5 5 0 0010 0V9"/>
              </svg>
            )}
          </span>
          <div>
            <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 3 }}>
              {winner === 'tie' ? '두 변형 성과 차이 5% 미만 — 동률' : '승자'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {winner && winner !== 'tie' && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: winnerBadgeBg,
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {winner?.toUpperCase()}
                </span>
              )}
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {winnerLabel}
              </span>
            </div>
          </div>
        </div>

        {/* 수동 확정 버튼 (tie 또는 미확정) */}
        {isManualNeeded && !confirming && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleConfirm('a')}
              disabled={confirming}
              aria-label="변형 A 승자로 확정"
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid var(--blue-200)',
                background: 'var(--blue-100)',
                color: 'var(--blue-600)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              변형 A 확정
            </button>
            <button
              type="button"
              onClick={() => handleConfirm('b')}
              disabled={confirming}
              aria-label="변형 B 승자로 확정"
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid #fde68a',
                background: 'var(--amber-100)',
                color: 'var(--amber-700)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              변형 B 확정
            </button>
            <button
              type="button"
              onClick={() => handleConfirm('tie')}
              disabled={confirming}
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'var(--n100)',
                color: 'var(--sub)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              동률 확정
            </button>
          </div>
        )}

        {confirming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sub)', fontSize: 12 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            확정 중…
          </div>
        )}

        {errorMsg && (
          <p style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
