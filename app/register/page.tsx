'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '회원가입에 실패했습니다.');
        setLoading(false);
        return;
      }

      router.replace('/login?registered=1');
    } catch {
      setError('서버 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', padding: '9px 12px', fontSize: 13, color: '#1e293b', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div style={{ width: 360, background: '#fff', borderRadius: 14, padding: '40px 36px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#1E3A6E,#2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 90 90" fill="none">
              <path d="M16 66L32 22L45 46L58 22L74 66" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A6E' }}>MINTEQ</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>마케팅 자동화 플랫폼</div>
          </div>
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>회원가입</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 24 }}>새 계정을 만드세요</div>

        <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 5 }}>이름</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" required style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 5 }}>이메일</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" required style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 5 }}>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8자 이상" required minLength={8} style={inputStyle} />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: '#fef2f2', borderRadius: 7, border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: 4, background: loading ? '#93c5fd' : '#2563EB', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}
          >
            {loading ? '가입 중...' : '회원가입'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
          이미 계정이 있으신가요?{' '}
          <Link href="/login" style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>로그인</Link>
        </div>
      </div>
    </div>
  );
}
