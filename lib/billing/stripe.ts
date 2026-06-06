// lib/billing/stripe.ts — Stripe 싱글톤 클라이언트
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY 환경변수 미설정');
  _stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' });
  return _stripe;
}
