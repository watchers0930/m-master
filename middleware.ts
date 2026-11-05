import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { isCrossSiteMutation } from '@/lib/security/origin';

const PUBLIC_PREFIXES = ['/login', '/register', '/api/auth', '/api/cron', '/api/billing/webhook', '/api/blog-publish'];

// 세션 쿠키 기반 /api 변이의 공통 CSRF 방어 — 라우트마다 붙이지 않고 여기 한 곳에서 일괄 적용.
// PUBLIC_PREFIXES(cron·webhook·블로그 워커·NextAuth)는 자체 인증(시크릿·서명·NextAuth CSRF)이라 제외.

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 랜딩 페이지 + 공개 경로
  if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/') && isCrossSiteMutation(req)) {
    return NextResponse.json({ error: { code: 'forbidden_origin', message: '허용되지 않은 요청 출처입니다.' } }, { status: 403 });
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
