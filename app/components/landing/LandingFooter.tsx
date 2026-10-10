import Link from 'next/link';
import { BrandMark } from './icons';

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="footer-top">
        <Link href="/" className="brand footer-brand-link">
          <BrandMark />
          <span>M-MASTER</span>
        </Link>
        <div className="footer-links">
          <Link href="#features">기능</Link>
          <Link href="#pricing">요금</Link>
          <Link href="/login">로그인</Link>
        </div>
      </div>
      <div className="footer-legal">
        <p className="footer-brand">BMI C&amp;S</p>
        <p>대표이사 김동의 · 사업자등록번호 263-87-03481 · 통신판매신고번호 2025-경기광명-0189</p>
        <p>서울시 강남구 강남대로 354(역삼동, 혜천빌딩) 1126-5호 · 고객센터 010-8490-9271</p>
      </div>
    </footer>
  );
}
