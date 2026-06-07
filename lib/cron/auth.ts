import { NextRequest } from 'next/server';

/** Vercel Cron CRON_SECRET Bearer 토큰 검증 */
export function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

/** 오늘 날짜 (KST) → 'YYYY-MM-DD' */
export function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
