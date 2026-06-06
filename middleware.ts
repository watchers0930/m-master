export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: [
    // 대시보드 전체 보호
    '/(dashboard)(.*)',
    // API 보호 (auth, cron 제외)
    '/api/((?!auth|cron).*)',
  ],
};
