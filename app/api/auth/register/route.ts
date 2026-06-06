import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { getStripe } from '@/lib/billing/stripe';

const RegisterSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요').max(50),
  email: z.string().email('유효한 이메일을 입력하세요'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다'),
  phone: z.string().min(10, '전화번호를 입력하세요').max(20),
  plan: z.enum(['free', 'starter', 'pro']).default('free'),
  checkoutSessionId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { name, email, password, phone, plan, checkoutSessionId } = parsed.data;

    // 중복 이메일 확인
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 });
    }

    // 유료 플랜: Stripe 결제 검증
    let stripeCustomerId: string | undefined;
    if (plan !== 'free') {
      if (!checkoutSessionId) {
        return NextResponse.json({ error: '결제 정보가 필요합니다.' }, { status: 400 });
      }
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (session.payment_status !== 'paid') {
        return NextResponse.json({ error: '결제가 확인되지 않았습니다.' }, { status: 400 });
      }
      stripeCustomerId = session.customer as string;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        plan,
        ...(stripeCustomerId ? { stripeId: stripeCustomerId } : {}),
      },
    });

    // 유료 플랜: Subscription 레코드 생성
    if (plan !== 'free' && stripeCustomerId) {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan,
          status: 'active',
        },
      });
    }

    // 기본 설정 레코드 생성
    await prisma.setting.create({
      data: {
        ownerId: user.id,
        brandGuide: {},
        promptTemplates: {},
        budgetMonthly: plan === 'pro' ? 500000 : plan === 'starter' ? 100000 : 10000,
        alertThreshold: 0.8,
        notifications: {},
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
