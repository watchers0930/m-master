'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

function RegisteredBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get('registered') !== '1') return null;
  return (
    <div style={{ fontSize: 12, color: '#16a34a', padding: '8px 12px', background: '#f0fdf4', borderRadius: 7, border: '1px solid #bbf7d0' }}>
      회원가입이 완료되었습니다. 로그인하세요.
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }

    router.replace('/');
  };

  const inputStyle = { width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', padding: '9px 12px', fontSize: 13, color: '#1e293b', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const };

  return (
    <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 5 }}>이메일</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" required style={inputStyle} />
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 5 }}>비밀번호</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required style={inputStyle} />
      </div>

      <Suspense>
        <RegisteredBanner />
      </Suspense>

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
        {loading ? '로그인 중...' : '로그인'}
      </button>
    </form>
  );
}

export default function LoginPage() {
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

        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>로그인</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 24 }}>계정으로 로그인하세요</div>

        <LoginForm />

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
          계정이 없으신가요?{' '}
          <Link href="/register" style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>회원가입</Link>
        </div>
      </div>
    </div>
  );
}
