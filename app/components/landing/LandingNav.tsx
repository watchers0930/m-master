import Link from 'next/link';
import { BrandMark } from './icons';

export function LandingNav() {
  return (
    <nav className="landing-nav" aria-label="주요 메뉴">
      <Link href="/" className="brand">
        <BrandMark />
        <span>M-MASTER</span>
      </Link>
      <div className="nav-actions">
        <Link href="#features" className="nav-link">기능</Link>
        <Link href="#pricing" className="nav-link">요금</Link>
        <Link href="/login" className="nav-login">로그인</Link>
      </div>
    </nav>
  );
}
