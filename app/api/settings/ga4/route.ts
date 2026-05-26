import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

export async function GET() {
  await requireSession();
  return NextResponse.json({
    ga4_property_id: process.env.GA4_PROPERTY_ID ?? '',
  });
}
