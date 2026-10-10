import Link from 'next/link';
import { ArrowIcon } from './icons';

const CHANNELS = ['네이버 블로그', '네이버 카페', 'Instagram', 'Facebook', 'GA4'] as const;

const STATS = [
  { value: '4개', label: '채널 동시 운영' },
  { value: '91점', label: '평균 콘텐츠 점수' },
  { value: '1/10', label: '운영 시간 절감' },
] as const;

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-copy">
        <p className="eyebrow"><span className="dot" />Context-aware marketing platform</p>
        <h1>
          마케팅의 모든 흐름을<br />
          <span className="grad-text">하나의 지능</span>으로
        </h1>
        <p className="hero-sub">
          브랜드 컨텍스트를 이해하는 AI가 콘텐츠 기획부터 초안 생성, 예약 발행,
          성과 분석까지 끊김 없이 연결합니다. 채널이 늘어도 운영은 그대로.
        </p>
        <div className="hero-actions">
          <Link href="/register?plan=starter" className="primary-cta primary-cta-lg">
            무료로 시작하기 <ArrowIcon />
          </Link>
        </div>
        <div className="trust-row" aria-label="연동 채널">
          <span className="trust-label">연동 채널</span>
          {CHANNELS.map((c) => (
            <span key={c} className="trust-chip">{c}</span>
          ))}
        </div>
      </div>
      <div className="hero-stats" aria-label="핵심 지표">
        {STATS.map((s) => (
          <div key={s.label} className="stat">
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
