import { withGa4Request } from './auth';
import { fetchOverviewKpi, fetchDailySeries, fetchTrafficSources, fetchTopPages, fetchEntryExit,
  fetchReferrals, fetchDemographics, fetchDevices, type Period } from './visitors';
import { scopedBlock } from './api';
import type { ScopeResult } from './scope';
export async function visitorData(period: Period, scope: ScopeResult) {
  return withGa4Request(async () => {
  const [kpi, daily] = await Promise.all([
    scopedBlock(scope, s => fetchOverviewKpi(period, s)), scopedBlock(scope, s => fetchDailySeries(period, s)),
  ]);
  const [traffic, pages, entry] = await Promise.all([
    scopedBlock(scope, s => fetchTrafficSources(period, s)), scopedBlock(scope, s => fetchTopPages(period, 20, s)),
    scopedBlock(scope, s => fetchEntryExit(period, s)),
  ]);
  const [refs, demo, devs] = await Promise.all([
    scopedBlock(scope, s => fetchReferrals(period, s)), scopedBlock(scope, s => fetchDemographics(period, s)),
    scopedBlock(scope, s => fetchDevices(period, s)),
  ]);
  return { kpi, traffic, daily, pages, refs, demo, devs, entry, period };
  });
}
