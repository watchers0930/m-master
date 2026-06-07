import Link from 'next/link';

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

// 플랜별 기능 비교표 데이터
const COMPARE_ROWS: readonly { label: string; free: string; starter: string; pro: string }[] = [
  { label: 'AI 콘텐츠 생성',       free: '5건/월',   starter: '30건/월',   pro: '무제한' },
  { label: 'AI 비용 한도',         free: '10,000원',  starter: '100,000원', pro: '500,000원' },
  { label: '발행 채널 수',         free: '1개',       starter: '3개',       pro: '무제한' },
  { label: '블로그 자동 발행',      free: 'O',        starter: 'O',         pro: 'O' },
  { label: '네이버 카페 발행',      free: 'O',        starter: 'O',         pro: 'O' },
  { label: 'GA4 성과 분석',       free: 'O',         starter: 'O',         pro: 'O' },
  { label: '인스타그램 발행',       free: '-',        starter: 'O',         pro: 'O' },
  { label: '페이스북 발행',        free: '-',         starter: 'O',         pro: 'O' },
  { label: '자동 스케줄링 (Cron)',  free: '-',        starter: 'O',         pro: 'O' },
  { label: 'RAG 문서 기반 생성',   free: '-',         starter: 'O',         pro: 'O' },
  { label: 'AI 토픽 추천',        free: '-',         starter: 'O',         pro: 'O' },
  { label: 'A/B 테스트',          free: '-',         starter: '-',         pro: 'O' },
];

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Paperozi', 'Noto Sans KR', sans-serif" }}>
      {/* 네비게이션 */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#1E3A6E,#2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 90 90" fill="none"><path d="M16 66L32 22L45 46L58 22L74 66" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1E3A6E' }}>MINTEQ</span>
        </div>
        <Link href="/login" style={{ fontSize: 13, color: '#475569', textDecoration: 'none', padding: '8px 16px' }}>로그인</Link>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '80px 24px 60px', maxWidth: 700, margin: '0 auto' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: '#0f172a', lineHeight: 1.3, marginBottom: 16 }}>
          마케팅 콘텐츠,<br />AI가 만들고 자동으로 발행합니다
        </h1>
        <p style={{ fontSize: 15, color: '#64748b', lineHeight: 1.7 }}>
          블로그, 카페, SNS 콘텐츠를 AI로 생성하고<br />
          예약 발행부터 성과 분석까지 한 곳에서 관리하세요.
        </p>
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
              <Link
                href={`/register?plan=${p.key}`}
                style={{
                  display: 'block', marginTop: 20, width: '100%', padding: '12px 0', borderRadius: 9, border: 'none',
                  background: p.highlight ? '#2563EB' : '#f1f5f9', color: p.highlight ? '#fff' : '#1e293b',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', textAlign: 'center',
                  boxSizing: 'border-box',
                }}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* 플랜 비교표 */}
      <section style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px 80px' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', textAlign: 'center', marginBottom: 24 }}>플랜별 기능 비교</h3>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '14px 20px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>기능</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 600, color: '#475569', width: 100 }}>Free</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 700, color: '#2563EB', width: 100 }}>Starter</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 600, color: '#475569', width: 100 }}>Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row, i) => (
                <tr key={row.label} style={{ borderBottom: i < COMPARE_ROWS.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <td style={{ padding: '12px 20px', color: '#334155' }}>{row.label}</td>
                  {(['free', 'starter', 'pro'] as const).map((plan) => {
                    const val = row[plan];
                    const isCheck = val === 'O';
                    const isDash = val === '-';
                    return (
                      <td key={plan} style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {isCheck ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : isDash ? (
                          <span style={{ color: '#cbd5e1', fontSize: 16 }}>—</span>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{val}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 푸터 */}
      <footer style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8' }}>
        &copy; 2026 MINTEQ. All rights reserved.
      </footer>
    </div>
  );
}
