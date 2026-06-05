import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import {
  fetchOverviewKpi, fetchTrafficSources, fetchDailySeries, fetchTopPages,
  fetchReferrals, fetchDemographics, fetchDevices, fetchEntryExit,
  type Period,
} from '@/lib/ga4/visitors';

const VALID: Period[] = ['today', 'yesterday', 'this_week', 'this_month', '7d', '30d', '90d', '365d'];

async function fetchAll(period: Period) {
  // GA4 API 동시 요청 제한(~10) 회피를 위해 3단계로 분산
  const [kpi, daily] = await Promise.all([
    fetchOverviewKpi(period),
    fetchDailySeries(period),
  ]);

  const [traffic, pages, entry] = await Promise.all([
    fetchTrafficSources(period),
    fetchTopPages(period, 20),
    fetchEntryExit(period),
  ]);

  const [refs, demo, devs] = await Promise.all([
    fetchReferrals(period),
    fetchDemographics(period),
    fetchDevices(period),
  ]);

  return { kpi, traffic, daily, pages, refs, demo, devs, entry };
}

export async function GET(req: NextRequest) {
  await requireSession();
  const raw = req.nextUrl.searchParams.get('period') ?? '30d';
  let period: Period = (VALID as string[]).includes(raw) ? (raw as Period) : '30d';

  try {
    let data = await fetchAll(period);

    // today 데이터가 비어있으면 yesterday로 폴백
    if (period === 'today' && data.kpi.sessions === 0 && data.kpi.pageViews === 0) {
      period = 'yesterday';
      data = await fetchAll(period);
    }

    return NextResponse.json({
      data: { ...data, period },
      error: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
