import Link from 'next/link';

const FEATURES = [
  {
    title: '콘텐츠 생성',
    desc: '브랜드 문서, 최근 성과, 채널별 문체를 반영해 블로그와 SNS 초안을 만듭니다.',
    icon: 'edit',
  },
  {
    title: '예약 발행',
    desc: '네이버 블로그와 카페, 인스타그램, 페이스북 발행 일정을 한 화면에서 관리합니다.',
    icon: 'calendar',
  },
  {
    title: '성과 분석',
    desc: 'GA4 방문자, 콘텐츠 점수, 전월 대비 변화를 대시보드에서 바로 확인합니다.',
    icon: 'chart',
  },
  {
    title: '토픽 추천',
    desc: '시즌 이슈와 검색 흐름을 반영해 다음 콘텐츠 주제를 자동으로 제안합니다.',
    icon: 'spark',
  },
] as const;

const PIPELINE = [
  { label: '자료 수집', value: 'RAG 문서 18개' },
  { label: '초안 생성', value: '블로그 3건 대기' },
  { label: '예약 편성', value: '6월 14건' },
  { label: '성과 회수', value: 'GA4 연결됨' },
] as const;

const PLANS: {
  name: string;
  price: string;
  note: string;
  cta: string;
  href: string;
  featured?: boolean;
}[] = [
  { name: 'Free', price: '0', note: '월 5건 생성', cta: '무료 시작', href: '/register?plan=free' },
  { name: 'Starter', price: '29,000', note: '월 30건 생성, 채널 3개', cta: 'Starter 시작', href: '/register?plan=starter', featured: true },
  { name: 'Pro', price: '79,000', note: '무제한 생성, A/B 테스트', cta: 'Pro 시작', href: '/register?plan=pro' },
] as const;

function Icon({ name }: { name: (typeof FEATURES)[number]['icon'] }) {
  if (name === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </svg>
    );
  }

  if (name === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M8 2v4M16 2v4M3 10h18" />
      </svg>
    );
  }

  if (name === 'chart') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19V5" />
        <path d="M4 19h17" />
        <path d="m8 15 3-4 3 2 4-7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8Z" />
      <path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="주요 메뉴">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 90 90" aria-hidden="true">
              <path d="M16 66 32 22l13 24 13-24 16 44" />
            </svg>
          </span>
          <span>M-MASTER</span>
        </Link>
        <div className="nav-actions">
          <Link href="#pricing">요금</Link>
          <Link href="/login" className="nav-login">로그인</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Context-aware marketing platform</p>
          <h1>M-MASTER</h1>
          <p className="hero-sub">
            콘텐츠 기획, AI 초안 생성, 예약 발행, 성과 분석을 한 번에 운영하는 마케팅 자동화 앱입니다.
          </p>
          <div className="hero-actions">
            <Link href="/register?plan=starter" className="primary-cta">시작하기</Link>
            <Link href="/login" className="secondary-cta">데모 보기</Link>
          </div>
          <div className="trust-row" aria-label="핵심 지표">
            <span>블로그</span>
            <span>네이버 카페</span>
            <span>Instagram</span>
            <span>GA4</span>
          </div>
        </div>

        <div className="product-shot" aria-label="M-MASTER 대시보드 미리보기">
          <div className="shot-sidebar">
            <div className="shot-logo">M</div>
            <span className="shot-active" />
            <span />
            <span />
            <span />
          </div>
          <div className="shot-main">
            <div className="shot-top">
              <div>
                <strong>마케팅 운영 대시보드</strong>
                <span>2026년 6월 캠페인</span>
              </div>
              <Link href="/home">열기</Link>
            </div>
            <div className="metric-grid">
              <div>
                <span>이번달 방문자</span>
                <strong>24,812</strong>
              </div>
              <div>
                <span>발행 완료</span>
                <strong>36건</strong>
              </div>
              <div>
                <span>평균 점수</span>
                <strong>91점</strong>
              </div>
            </div>
            <div className="preview-grid">
              <div className="calendar-preview">
                {Array.from({ length: 28 }, (_, index) => (
                  <span
                    key={index}
                    className={index === 9 || index === 15 || index === 22 ? 'has-post' : ''}
                  />
                ))}
              </div>
              <div className="topic-preview">
                <p>추천 토픽</p>
                <strong>여름 성수기 전환 캠페인</strong>
                <span>검색 상승 + 시즌성 + 기존 성과</span>
                <div className="score-bar"><i /></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pipeline" aria-label="마케팅 자동화 흐름">
        {PIPELINE.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="feature-band">
        <div className="section-head">
          <p>운영 기능</p>
          <h2>마케터가 매일 반복하는 일을 앱 안에 묶었습니다</h2>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="feature-item">
              <span className="feature-icon"><Icon name={feature.icon} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="pricing-band">
        <div className="section-head">
          <p>요금제</p>
          <h2>작게 시작하고, 채널이 늘면 확장하세요</h2>
        </div>
        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <article key={plan.name} className={`price-item${plan.featured ? ' featured' : ''}`}>
              {plan.featured && <span className="plan-badge">추천</span>}
              <h3>{plan.name}</h3>
              <div className="price">
                <strong>{plan.price}</strong>
                <span>원/월</span>
              </div>
              <p>{plan.note}</p>
              <Link href={plan.href}>{plan.cta}</Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
