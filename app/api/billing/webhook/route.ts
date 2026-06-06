// POST /api/billing/webhook — Stripe Webhook 수신
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/billing/stripe';
import type Stripe from 'stripe';

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const body = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;
      const subId = session.subscription as string;

      if (userId && plan && subId) {
        const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data'] });
        const periodEnd = sub.items?.data?.[0]?.current_period_end;
        await prisma.subscription.create({
          data: {
            userId,
            stripeSubId: subId,
            plan,
            status: 'active',
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          },
        });
        await prisma.user.update({
          where: { id: userId },
          data: { plan },
        });
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const existing = await prisma.subscription.findUnique({
        where: { stripeSubId: sub.id },
      });
      if (existing) {
        const status = sub.status === 'active' ? 'active'
          : sub.status === 'past_due' ? 'past_due'
          : 'canceled';
        const periodEnd = sub.items?.data?.[0]?.current_period_end;
        await prisma.subscription.update({
          where: { stripeSubId: sub.id },
          data: {
            status,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
          },
        });
        if (status === 'canceled') {
          await prisma.user.update({
            where: { id: existing.userId },
            data: { plan: 'free' },
          });
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const existing = await prisma.subscription.findUnique({
        where: { stripeSubId: sub.id },
      });
      if (existing) {
        await prisma.subscription.update({
          where: { stripeSubId: sub.id },
          data: { status: 'canceled' },
        });
        await prisma.user.update({
          where: { id: existing.userId },
          data: { plan: 'free' },
        });
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
