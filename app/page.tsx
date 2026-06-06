'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const FEATURES = [
  { title: 'AI 콘텐츠 생성', desc: 'GPT 기반 블로그·SNS 글을 한 번에 생성하고, RAG로 브랜드 톤을 유지합니다.', icon: '✍️' },
  { title: '멀티채널 자동 발행', desc: '네이버 블로그·카페, 인스타그램, 페이스북에 예약 발행합니다.', icon: '📡' },
  { title: 'A/B 테스트', desc: '제목·본문 변형을 자동 생성하고 GA4 데이터로 성과를 비교합니다.', icon: '🧪' },
  { title: '성과 분석', desc: 'GA4 연동으로 조회수·클릭률을 실시간 추적하고 토픽을 추천합니다.', icon: '📊' },
];

const PLANS: readonly { key: string; name: string; price: string; unit: string; content: string; cost: string; channels: string; cta: string; highlight?: boolean }[] = [
  { key: 'free', name: 'Free', price: '0', unit: '원/월', content: '5건/월', cost: '10,000원', channels: '1개', cta: '무료로 시작' },
  { key: 'starter', name: 'Starter', price: '29,000', unit: '원/월', content: '30건/월', cost: '100,000원', channels: '3개', cta: '시작하기', highlight: true },
  { key: 'pro', name: 'Pro', price: '79,000', unit: '원/월', content: '무제한', cost: '500,000원', channels: '무제한', cta: '시작하기' },
];

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState('');

  const handlePlan = async (plan: string) => {
    if (plan === 'free') {
      router.push('/register?plan=free');
      return;
    }
    setLoading(plan);
    try {
      const res = await fetch('/api/auth/signup-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    } catch { /* ignore */ }
    setLoading('');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Noto Sans KR', sans-serif" }}>
      {/* 네비게이션 */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#1E3A6E,#2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 90 90" fill="none"><path d="M16 66L32 22L45 46L58 22L74 66" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1E3A6E' }}>MINTEQ</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/login" style={{ fontSize: 13, color: '#475569', textDecoration: 'none', padding: '8px 16px' }}>로그인</Link>
          <Link href="/register?plan=free" style={{ fontSize: 13, color: '#fff', background: '#2563EB', borderRadius: 7, padding: '8px 16px', textDecoration: 'none', fontWeight: 600 }}>무료 시작</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '80px 24px 60px', maxWidth: 700, margin: '0 auto' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: '#0f172a', lineHeight: 1.3, marginBottom: 16 }}>
          마케팅 콘텐츠,<br />AI가 만들고 자동으로 발행합니다
        </h1>
        <p style={{ fontSize: 15, color: '#64748b', lineHeight: 1.7, marginBottom: 32 }}>
          블로그, 카페, SNS 콘텐츠를 AI로 생성하고<br />
          예약 발행부터 성과 분석까지 한 곳에서 관리하세요.
        </p>
        <Link href="#pricing" style={{ display: 'inline-block', background: '#2563EB', color: '#fff', padding: '14px 32px', borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
          요금제 보기
        </Link>
      </section>

      {/* 기능 소개 */}
      <section style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: '#fff', borderRadius: 12, padding: '28px 24px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 요금제 */}
      <section id="pricing" style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 80px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', textAlign: 'center', marginBottom: 8 }}>요금제</h2>
        <p style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 36 }}>필요에 맞는 플랜을 선택하세요</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {PLANS.map((p) => (
            <div key={p.key} style={{
              background: '#fff', borderRadius: 14, padding: '32px 28px',
              border: p.highlight ? '2px solid #2563EB' : '1px solid #e2e8f0',
              position: 'relative',
            }}>
              {p.highlight && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#2563EB', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 14px', borderRadius: 20 }}>추천</div>
              )}
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{p.name}</div>
              <div style={{ margin: '12px 0 20px' }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: '#2563EB' }}>{p.price}</span>
                <span style={{ fontSize: 13, color: '#64748b' }}>{p.unit}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 2 }}>
                <div>콘텐츠: <strong>{p.content}</strong></div>
                <div>AI 비용 한도: <strong>{p.cost}</strong></div>
                <div>채널: <strong>{p.channels}</strong></div>
              </div>
              <button
                onClick={() => handlePlan(p.key)}
                disabled={loading === p.key}
                style={{
                  marginTop: 20, width: '100%', padding: '12px 0', borderRadius: 9, border: 'none',
                  background: p.highlight ? '#2563EB' : '#f1f5f9', color: p.highlight ? '#fff' : '#1e293b',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {loading === p.key ? '처리 중...' : p.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 푸터 */}
      <footer style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8' }}>
        &copy; 2026 MINTEQ. All rights reserved.
      </footer>
    </div>
  );
}
