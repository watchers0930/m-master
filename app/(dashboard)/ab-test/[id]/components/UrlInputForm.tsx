'use client';

import { useState } from 'react';
import type { AbTest } from '@/types/db';
import type { AbTestMeasureDays } from '@/types/db';
import { updateAbTest } from '@/lib/api/ab-test';

interface Props {
  test: AbTest;
  onUpdated: (updated: AbTest) => void;
}

const fieldStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  borderRadius: 7,
  padding: '8px 11px',
  fontSize: 12.5,
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
};

export default function UrlInputForm({ test, onUpdated }: Props) {
  const isRunning   = test.status === 'running';
  const isLocked    = test.status === 'running' || test.status === 'completed' || test.status === 'cancelled';

  const [urlA, setUrlA]           = useState(test.variant_a_url ?? '');
  const [urlB, setUrlB]           = useState(test.variant_b_url ?? '');
  const [measureDays, setMeasure] = useState<AbTestMeasureDays>(test.measure_days);
  const [saving, setSaving]       = useState(false);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [saved, setSaved]         = useState(false);

  // test prop이 외부에서 갱신되면 폼 상태를 재초기화 (React: 렌더 중 setState로 derived state 리셋)
  const [prevTestUpdatedAt, setPrevTestUpdatedAt] = useState(test.updated_at);
  if (prevTestUpdatedAt !== test.updated_at) {
    setPrevTestUpdatedAt(test.updated_at);
    setUrlA(test.variant_a_url ?? '');
    setUrlB(test.variant_b_url ?? '');
    setMeasure(test.measure_days);
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;

    setSaving(true);
    setErrorMsg(null);

    const res = await updateAbTest(test.id, {
      variant_a_url: urlA.trim() || null,
      variant_b_url: urlB.trim() || null,
      measure_days: measureDays,
    });

    setSaving(false);

    if (res.error) {
      setErrorMsg(res.error.message ?? 'URL 저장에 실패했습니다');
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onUpdated(res.data);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">발행 URL 입력</span>
        {isRunning && (
          <span
            style={{
              fontSize: 10.5,
              color: 'var(--blue-600)',
              background: 'var(--blue-100)',
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            측정 중 — 변경 불가
          </span>
        )}
      </div>

      <form onSubmit={handleSave} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 변형 A URL */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: 'var(--blue-600)', color: '#fff', fontSize: 9, fontWeight: 700 }}>A</span>
            변형 A 발행 URL
          </label>
          <input
            type="url"
            value={urlA}
            onChange={(e) => setUrlA(e.target.value)}
            placeholder="https://blog.naver.com/vestra/..."
            disabled={isLocked}
            aria-disabled={isLocked}
            style={{
              ...fieldStyle,
              width: '100%',
              background: isLocked ? 'var(--n50)' : 'var(--surface)',
              color: isLocked ? 'var(--sub)' : 'var(--text)',
              cursor: isLocked ? 'not-allowed' : 'text',
            }}
          />
        </div>

        {/* 변형 B URL */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: 'var(--amber-500)', color: '#fff', fontSize: 9, fontWeight: 700 }}>B</span>
            변형 B 발행 URL
          </label>
          <input
            type="url"
            value={urlB}
            onChange={(e) => setUrlB(e.target.value)}
            placeholder="https://blog.naver.com/vestra/..."
            disabled={isLocked}
            aria-disabled={isLocked}
            style={{
              ...fieldStyle,
              width: '100%',
              background: isLocked ? 'var(--n50)' : 'var(--surface)',
              color: isLocked ? 'var(--sub)' : 'var(--text)',
              cursor: isLocked ? 'not-allowed' : 'text',
            }}
          />
        </div>

        {/* 측정 기간 */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 6 }}>
            측정 기간
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {([7, 14, 30] as const).map((d) => (
              <label
                key={d}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  borderRadius: 7,
                  border: `1px solid ${measureDays === d ? 'var(--blue-400)' : 'var(--border)'}`,
                  background: measureDays === d ? 'var(--blue-50)' : 'var(--surface)',
                  color: measureDays === d ? 'var(--blue-600)' : 'var(--sub)',
                  fontSize: 12,
                  fontWeight: measureDays === d ? 700 : 400,
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.6 : 1,
                  transition: 'all 0.12s',
                }}
              >
                <input
                  type="radio"
                  name="measure_days_url"
                  value={d}
                  checked={measureDays === d}
                  disabled={isLocked}
                  onChange={() => !isLocked && setMeasure(d)}
                  style={{ display: 'none' }}
                />
                {d}일
              </label>
            ))}
          </div>
        </div>

        {/* 오류 */}
        {errorMsg && (
          <p style={{ fontSize: 11, color: '#dc2626' }}>{errorMsg}</p>
        )}

        {/* running 안내 */}
        {isRunning && (
          <p style={{ fontSize: 11, color: 'var(--sub)', background: 'var(--n50)', padding: '6px 10px', borderRadius: 5 }}>
            측정 중에는 URL 및 측정 기간을 변경할 수 없습니다.
          </p>
        )}

        {!isLocked && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{ opacity: saving ? 0.7 : 1 }}
            >
              {saved ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  저장됨
                </>
              ) : saving ? '저장 중…' : 'URL 저장'}
            </button>
          </div>
        )}

        <p style={{ fontSize: 10.5, color: 'var(--sub)' }}>
          두 URL을 모두 입력하면 자동으로 측정이 시작됩니다.
        </p>
      </form>
    </div>
  );
}
