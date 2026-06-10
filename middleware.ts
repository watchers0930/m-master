import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/register', '/api/auth', '/api/cron', '/api/billing/webhook', '/api/blog-publish'];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 랜딩 페이지 + 공개 경로
  if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // 미인증 → 로그인 페이지
  if (!req.auth) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next|favicon|public|.*\\.).*)'],
};
