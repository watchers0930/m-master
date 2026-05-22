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
    // GA4 API 동시 요청 제한(~10) 회피를 위해 3단계로 분산
    // Phase 1: KPI(2) + daily(1) = 3 concurrent GA4 calls
    const [kpi, daily] = await Promise.all([
      fetchOverviewKpi(period),
      fetchDailySeries(period),
    ]);

    // Phase 2: traffic(1) + pages(1) + entry(2) = 4 concurrent
    const [traffic, pages, entry] = await Promise.all([
      fetchTrafficSources(period),
      fetchTopPages(period, 20),
      fetchEntryExit(period),
    ]);

    // Phase 3: refs(2) + demo(3) + devs(3) = 8 concurrent
    const [refs, demo, devs] = await Promise.all([
      fetchReferrals(period),
      fetchDemographics(period),
      fetchDevices(period),
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
