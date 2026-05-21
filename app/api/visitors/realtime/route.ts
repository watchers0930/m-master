import { NextResponse } from 'next/server';
import { fetchRealtime } from '@/lib/ga4/visitors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await fetchRealtime();
  return NextResponse.json(data);
}
