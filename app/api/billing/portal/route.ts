// POST /api/billing/portal — Stripe Customer Portal 리다이렉트
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/billing/stripe';

export async function POST() {
  const session = await requireSession();
  const userId = session.user.id;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeId) {
    return NextResponse.json(
      { error: { code: 'no_subscription', message: '구독 정보가 없습니다.' } },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const baseUrl = process.env.NEXTAUTH_URL || 'https://m-master.vercel.app';

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripeId,
    return_url: `${baseUrl}/billing`,
  });

  return NextResponse.json({ data: { url: portalSession.url }, error: null });
}
