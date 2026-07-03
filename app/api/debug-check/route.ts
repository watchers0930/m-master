import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function GET() {
  try {
    const count = await prisma.user.count();
    return NextResponse.json({ ok: true, userCount: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return NextResponse.json({ step: 'find', result: 'user not found' });
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return NextResponse.json({ step: 'bcrypt', result: 'password mismatch' });
    return NextResponse.json({ step: 'ok', userId: user.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ step: 'error', error: msg }, { status: 500 });
  }
}
