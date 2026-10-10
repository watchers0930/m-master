import Link from 'next/link';
import { CheckIcon } from './icons';

const PLANS: {
  name: string;
  price: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
}[] = [
  {
    name: 'Free',
    price: '0',
    tagline: '가볍게 시작하기',
    features: ['월 5건 콘텐츠 생성', '채널 1개 연동', '기본 성과 대시보드'],
    cta: '무료 시작',
    href: '/register?plan=free',
  },
  {
    name: 'Starter',
    price: '29,000',
    tagline: '본격 운영을 위한',
    features: ['월 30건 콘텐츠 생성', '채널 3개 연동', '예약 발행 · 토픽 추천', 'GA4 성과 분석'],
    cta: 'Starter 시작',
    href: '/register?plan=starter',
    featured: true,
  },
  {
    name: 'Pro',
    price: '79,000',
    tagline: '제한 없는 확장',
    features: ['무제한 콘텐츠 생성', '전 채널 연동', 'A/B 테스트', 'RAG 문서 검색', '우선 지원'],
    cta: 'Pro 시작',
    href: '/register?plan=pro',
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="pricing-band">
      <div className="section-head reveal">
        <p className="section-eyebrow">PRICING</p>
        <h2>작게 시작하고,<br /><span className="grad-text">채널이 늘면 확장</span>하세요</h2>
        <p className="section-desc">무료로 효과를 확인하고 필요한 만큼만 확장하세요. 언제든 플랜을 변경할 수 있습니다.</p>
      </div>
      <div className="pricing-grid">
        {PLANS.map((plan) => (
          <article key={plan.name} className={`price-item reveal${plan.featured ? ' featured' : ''}`}>
            {plan.featured && <span className="plan-badge">가장 인기</span>}
            <p className="plan-tagline">{plan.tagline}</p>
            <h3>{plan.name}</h3>
            <div className="price">
              <strong>{plan.price}</strong>
              <span>원 / 월</span>
            </div>
            <ul className="plan-features">
              {plan.features.map((f) => (
                <li key={f}><CheckIcon />{f}</li>
              ))}
            </ul>
            <Link href={plan.href} className="plan-cta">{plan.cta}</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
