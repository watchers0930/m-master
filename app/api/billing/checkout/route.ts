// POST /api/billing/checkout — Stripe Checkout 세션 생성
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/billing/stripe';

const Schema = z.object({
  plan: z.enum(['starter', 'pro']),
});

const PRICE_MAP: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
};

export async function POST(request: NextRequest) {
  const session = await requireSession();
  const userId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation', message: '유효하지 않은 플랜' } }, { status: 400 });
  }

  const priceId = PRICE_MAP[parsed.data.plan];
  if (!priceId) {
    return NextResponse.json({ error: { code: 'config', message: 'Stripe Price ID 미설정' } }, { status: 500 });
  }

  const stripe = getStripe();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: { code: 'not_found', message: '사용자 없음' } }, { status: 404 });
  }

  // Stripe Customer 생성 또는 재사용
  let customerId = user.stripeId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: userId }, data: { stripeId: customerId } });
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'https://m-master.vercel.app';

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/billing?success=1`,
    cancel_url: `${baseUrl}/billing?canceled=1`,
    metadata: { userId, plan: parsed.data.plan },
  });

  return NextResponse.json({ data: { url: checkoutSession.url }, error: null });
}
