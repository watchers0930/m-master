'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'idle' | 'loading' | 'success' | 'error';

export function RefreshTopicsButton() {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');
  const [errMsg, setErrMsg] = useState<string>('');

  const handleClick = async () => {
    if (state === 'loading') return;
    setState('loading');
    setErrMsg('');
    try {
      const res = await fetch('/api/topics/refresh', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: { message: '갱신 실패' } }));
        setErrMsg(j?.error?.message ?? '갱신 실패');
        setState('error');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      setState('success');
      router.refresh();
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setErrMsg('네트워크 오류');
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const label = state === 'loading' ? '갱신 중...'
    : state === 'success' ? '갱신 완료'
    : state === 'error' ? (errMsg || '실패')
    : '갱신';

  const color = state === 'success' ? 'var(--green, #16a34a)'
    : state === 'error' ? '#ef4444'
    : 'var(--c400)';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: 'transparent', border: 'none', cursor: state === 'loading' ? 'wait' : 'pointer',
        fontSize: 11, color, fontFamily: 'inherit', padding: 0,
      }}
      title="이번 달 추천 토픽 다시 생성"
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        style={{ animation: state === 'loading' ? 'spin 1s linear infinite' : undefined }}
      >
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
      </svg>
      {label}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}
