import type { protos } from '@google-analytics/data';
import type { Ga4Result } from '@/types/ga4';
import type { ConsultingGa4 } from '@/schemas/ga4-consulting';
import { resolveGa4Scope } from '@/lib/ga4/scope';
import { runGa4 } from '@/lib/ga4/run';
export const GA4_REPORTS = {
  channels: { dimension: 'sessionDefaultChannelGroup', metrics: ['activeUsers','sessions','engagedSessions','engagementRate'] },
  sourceMedium: { dimension: 'sessionSourceMedium', metrics: ['sessions','activeUsers'] },
  landing: { dimension: 'landingPage', metrics: ['sessions','engagedSessions','engagementRate','keyEvents'] },
  pages: { dimension: 'pagePath', metrics: ['screenPageViews','activeUsers','userEngagementDuration'] },
  events: { dimension: 'eventName', metrics: ['eventCount','keyEvents'] },
} as const;
export type ReportName = keyof typeof GA4_REPORTS;
type RawReport = protos.google.analytics.data.v1beta.IRunReportResponse;
export type Ga4Collection = Ga4Result<ConsultingGa4>;
export function ga4Text(value: string) { return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200); }
function metric(value?: string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid_ga4_metric');
  return parsed;
}
export async function collectGa4(ownerId: string, domainId: string, range: { from: string; to: string }): Promise<Ga4Collection> {
  const resolved = await resolveGa4Scope(ownerId, domainId);
  if (!resolved.ok) return { status: 'unavailable', reason: resolved.reason };
  const dates = { startDate: range.from.slice(0,10), endDate: range.to.slice(0,10) };
  const names = Object.keys(GA4_REPORTS) as ReportName[];
  const result = await runGa4(resolved.scope, 'ga4-consulting-v1', dates, async (client, property) => {
    const requests = names.map(name => {
      const definition = GA4_REPORTS[name];
      return { property, dateRanges: [dates], dimensions: [{ name: definition.dimension }],
        metrics: definition.metrics.map(name => ({ name })), limit: 20, metricAggregations: [1],
        ...(name === 'events' ? { dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: {
          values: [...new Set(['form_start', ...resolved.scope.conversionEvents])],
        } } } } : {}),
      };
    });
    const [batch] = await client.batchRunReports({ property, requests });
    const reports: Record<string, unknown> = {};
    const totals: Record<string, Record<string, number> | null> = {};
    const failedQueries: ConsultingGa4['failedQueries'] = [];
    for (let index = 0; index < names.length; index++) {
      const name = names[index], report: RawReport | undefined = batch.reports?.[index];
      if (!report) { failedQueries.push({ report: name, code: 'upstream_error' }); reports[name] = []; totals[name] = null; continue; }
      const metrics = GA4_REPORTS[name].metrics;
      try {
        reports[name] = (report.rows ?? []).slice(0,20).map((row, i) => {
          const values = Object.fromEntries(metrics.map((m, j) => {
            const value = metric(row.metricValues?.[j]?.value);
            if (value === null && m !== 'keyEvents') throw new Error('missing_metric');
            return [m, value];
          }));
          return { key: ga4Text(row.dimensionValues?.[0]?.value ?? ''), ...values,
            evidenceIds: metrics.map(m => `ga4_${name}_${i}_${m}`) };
        });
        const total = report.totals?.[0];
        totals[name] = total ? Object.fromEntries(metrics.flatMap((m,j) => {
          const value = metric(total.metricValues?.[j]?.value); return value === null ? [] : [[m,value]];
        })) : null;
      } catch { reports[name] = []; totals[name] = null; failedQueries.push({ report: name, code: 'upstream_error' }); }
    }
    if (failedQueries.length === names.length) throw new Error('all_ga4_reports_failed');
    return { reports: { ...reports, totals: { channels: totals.channels, landing: totals.landing, pages: totals.pages, events: totals.events } }, failedQueries };
  }, 300000, 20000);
  if (result.status !== 'success') return result;
  const provenance = { ...result.provenance, completeness: result.data.failedQueries.length ? 'partial' as const : result.provenance.completeness };
  return { status: 'success', provenance, data: { ...result.data, provenance } as ConsultingGa4 };
}
