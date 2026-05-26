import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { fetchRealtime } from '@/lib/ga4/visitors';

export const dynamic = 'force-dynamic';

export async function GET() {
  await requireSession();
  const data = await fetchRealtime();
  return NextResponse.json(data);
}
