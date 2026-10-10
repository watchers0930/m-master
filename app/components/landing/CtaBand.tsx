import Link from 'next/link';
import { ArrowIcon } from './icons';

export function CtaBand() {
  return (
    <section className="cta-band reveal">
      <div className="cta-inner">
        <div className="cta-glow" aria-hidden="true" />
        <h2>지금, 마케팅 운영을<br /><span className="grad-text">자동화할 시간</span>입니다</h2>
        <p>가입 후 바로 첫 콘텐츠를 생성해보세요. 카드 등록 없이 무료로 시작할 수 있습니다.</p>
        <div className="cta-actions">
          <Link href="/register?plan=starter" className="primary-cta">
            무료로 시작하기 <ArrowIcon />
          </Link>
          <Link href="/login" className="secondary-cta">로그인</Link>
        </div>
      </div>
    </section>
  );
}
