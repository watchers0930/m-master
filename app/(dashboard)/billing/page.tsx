'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface UsageInfo {
  plan: string;
  contentCount: number;
  costKrw: number;
}

const PLAN_INFO = {
  free:    { label: 'Free',    price: '0원/월',     content: '5건/월',  cost: '10,000원', channels: '1개' },
  starter: { label: 'Starter', price: '29,000원/월', content: '30건/월', cost: '100,000원', channels: '3개' },
  pro:     { label: 'Pro',     price: '79,000원/월', content: '무제한',  cost: '500,000원', channels: '무제한' },
} as const;

export default function BillingPage() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/billing/usage')
      .then((r) => r.json())
      .then((res) => setUsage(res.data))
      .catch(() => {});
  }, []);

  const currentPlan = (usage?.plan ?? 'free') as keyof typeof PLAN_INFO;
  const info = PLAN_INFO[currentPlan];

  const handleCheckout = async (plan: 'starter' | 'pro') => {
    setLoading(true);
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.data?.url) window.location.href = data.data.url;
  };

  const handlePortal = async () => {
    setLoading(true);
    const res = await fetch('/api/billing/portal', { method: 'POST' });
    const data = await res.json();
    setLoading(false);
    if (data.data?.url) window.location.href = data.data.url;
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 20,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>구독 / 과금</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
          현재 플랜: <strong>{info.label}</strong> ({info.price})
        </p>
      </div>

      {/* 이번 달 사용량 */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>이번 달 사용량</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: 'var(--blue-50)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--sub)' }}>콘텐츠 생성</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
              {usage?.contentCount ?? 0}<span style={{ fontSize: 12, fontWeight: 400 }}> / {info.content}</span>
            </div>
          </div>
          <div style={{ background: 'var(--blue-50)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--sub)' }}>AI 비용</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
              {(usage?.costKrw ?? 0).toLocaleString()}<span style={{ fontSize: 12, fontWeight: 400 }}>원 / {info.cost}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 플랜 선택 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {(['free', 'starter', 'pro'] as const).map((plan) => {
          const p = PLAN_INFO[plan];
          const isCurrent = currentPlan === plan;
          return (
            <div
              key={plan}
              style={{
                ...cardStyle,
                border: isCurrent ? '2px solid var(--blue-500)' : '1px solid var(--border)',
                position: 'relative',
              }}
            >
              {isCurrent && (
                <div style={{ position: 'absolute', top: -10, right: 12, background: 'var(--blue-500)', color: '#fff', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                  현재
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue-600)', margin: '8px 0' }}>{p.price}</div>
              <div style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.8 }}>
                <div>콘텐츠: {p.content}</div>
                <div>AI 비용: {p.cost}</div>
                <div>채널: {p.channels}</div>
              </div>
              {!isCurrent && plan !== 'free' && (
                <button
                  onClick={() => handleCheckout(plan)}
                  disabled={loading}
                  style={{
                    marginTop: 12, width: '100%', padding: '8px 0', borderRadius: 7,
                    background: 'var(--blue-500)', color: '#fff', border: 'none',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {loading ? '처리 중...' : '업그레이드'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 구독 관리 */}
      {currentPlan !== 'free' && (
        <button
          onClick={handlePortal}
          disabled={loading}
          style={{
            alignSelf: 'flex-start', padding: '8px 20px', borderRadius: 7,
            background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          구독 관리 (Stripe Portal)
        </button>
      )}
    </div>
  );
}
