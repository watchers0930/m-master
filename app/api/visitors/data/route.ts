import { NextRequest, NextResponse } from 'next/server';
import {
  fetchOverviewKpi, fetchTrafficSources, fetchDailySeries, fetchTopPages,
  fetchReferrals, fetchDemographics, fetchDevices, fetchEntryExit,
  type Period,
} from '@/lib/ga4/visitors';

const VALID: Period[] = ['today', 'this_week', 'this_month', '7d', '30d', '90d', '365d'];

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('period') ?? '30d';
  const period: Period = (VALID as string[]).includes(raw) ? (raw as Period) : '30d';

  try {
    const [kpi, traffic, daily, pages, refs, demo, devs, entry] = await Promise.all([
      fetchOverviewKpi(period),
      fetchTrafficSources(period),
      fetchDailySeries(period),
      fetchTopPages(period, 20),
      fetchReferrals(period),
      fetchDemographics(period),
      fetchDevices(period),
      fetchEntryExit(period),
    ]);

    return NextResponse.json({
      data: { kpi, traffic, daily, pages, refs, demo, devs, entry },
      error: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
