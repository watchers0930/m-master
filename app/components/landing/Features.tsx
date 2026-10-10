import { FeatureIcon, type FeatureIconName } from './icons';

const FEATURES: { title: string; desc: string; icon: FeatureIconName; tag: string }[] = [
  {
    title: '콘텐츠 생성',
    desc: '브랜드 문서, 최근 성과, 채널별 문체를 반영해 블로그와 SNS 초안을 자동으로 만듭니다.',
    icon: 'edit',
    tag: 'AI 초안',
  },
  {
    title: '예약 발행',
    desc: '네이버 블로그·카페, 인스타그램, 페이스북 발행 일정을 한 화면에서 관리합니다.',
    icon: 'calendar',
    tag: '멀티채널',
  },
  {
    title: '성과 분석',
    desc: 'GA4 방문자, 콘텐츠 점수, 전월 대비 변화를 대시보드에서 바로 확인합니다.',
    icon: 'chart',
    tag: 'GA4 연동',
  },
  {
    title: '토픽 추천',
    desc: '시즌 이슈와 검색 흐름을 반영해 다음 콘텐츠 주제를 자동으로 제안합니다.',
    icon: 'spark',
    tag: '트렌드',
  },
];

export function Features() {
  return (
    <section id="features" className="feature-band">
      <div className="section-head reveal">
        <p className="section-eyebrow">WHAT IT DOES</p>
        <h2>마케터가 매일 반복하는 일을,<br /><span className="grad-text">하나의 흐름</span>으로 묶었습니다</h2>
        <p className="section-desc">기획부터 발행, 성과 분석까지 끊김 없이 연결됩니다. 채널이 늘어도 운영 방식은 그대로 유지됩니다.</p>
      </div>
      <div className="feature-grid">
        {FEATURES.map((feature, i) => (
          <article key={feature.title} className="feature-item reveal" style={{ ['--i' as string]: i }}>
            <span className="feature-icon"><FeatureIcon name={feature.icon} /></span>
            <span className="feature-tag">{feature.tag}</span>
            <h3>{feature.title}</h3>
            <p>{feature.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
