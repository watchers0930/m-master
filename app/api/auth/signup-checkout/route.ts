// POST /api/auth/signup-checkout — 가입 전 Stripe 결제 (인증 불요)
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStripe } from '@/lib/billing/stripe';

const Schema = z.object({
  plan: z.enum(['starter', 'pro']),
});

const PRICE_MAP: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '유효하지 않은 플랜' }, { status: 400 });
  }

  const plan = parsed.data.plan;
  const priceId = PRICE_MAP[plan];
  if (!priceId) {
    return NextResponse.json({ error: 'Stripe Price ID 미설정' }, { status: 500 });
  }

  const stripe = getStripe();
  const baseUrl = process.env.NEXTAUTH_URL || 'https://m-master.vercel.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/register?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: baseUrl,
    metadata: { plan },
  });

  return NextResponse.json({ url: session.url });
}
