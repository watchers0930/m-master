import type { BetaAnalyticsDataClient, protos } from '@google-analytics/data';
import type { Ga4Scope, Ga4Result, Ga4Provenance } from '@/types/ga4';
import { credentialCandidates } from './auth';
import { classifyGa4Error, Ga4Failure } from './errors';
type Report = protos.google.analytics.data.v1beta.IRunReportRequest;
type ReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;
export type ScopedGa4Client = Pick<BetaAnalyticsDataClient, 'runReport' | 'runRealtimeReport' | 'batchRunReports'>;
const cache = new Map<string, { until: number; result: Ga4Result<unknown> }>();
const suppressed = new Map<string, { until: number; code: 'invalid_credentials' | 'permission_denied' }>();
const inFlight = new Map<string, Promise<Ga4Result<unknown>>>();
function hostFilter(scope: Ga4Scope, request: Report): Report {
  const host = { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT' as const, value: scope.host, caseSensitive: false } } };
  return { ...request, property: scope.propertyId, limit: request.limit ?? 100,
    dimensionFilter: request.dimensionFilter ? { andGroup: { expressions: [host, request.dimensionFilter] } } : host };
}
export async function runGa4<T>(scope: Ga4Scope | undefined, queryKey: string,
  range: { startDate: string; endDate: string }, work: (client: ScopedGa4Client, property: string) => Promise<T>, ttl = 300000, timeoutMs = 15000): Promise<Ga4Result<T>> {
  if (!scope) return { status: 'unavailable', reason: 'not_configured' };
  let candidates: Awaited<ReturnType<typeof credentialCandidates>>;
  try { candidates = await credentialCandidates(scope); } catch { return { status: 'error', code: 'upstream_error', retryable: true }; }
  if (!candidates.length) return { status: 'unavailable', reason: 'not_configured' };
  const key = JSON.stringify([candidates.map(c => c.version), scope.ownerId, scope.propertyId, scope.host, scope.streamId, scope.bindingId, queryKey, range]);
  const saved = cache.get(key);
  if (saved && saved.until > Date.now()) return saved.result as Ga4Result<T>;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<Ga4Result<T>>;
  const promise = (async (): Promise<Ga4Result<T>> => {
    const attempts: { source: import('@/types/ga4').Ga4CredentialSource; code: import('@/types/ga4').Ga4ErrorCode }[] = [];
    let last = { code: 'invalid_credentials' as const as import('@/types/ga4').Ga4ErrorCode, retryable: false };
    const deadline = Date.now() + timeoutMs;
    for (const candidate of candidates) {
      const suppressionKey = `${candidate.version}:${scope.ownerId}:${scope.propertyId}`;
      const suppression = suppressed.get(suppressionKey);
      if (suppression && suppression.until > Date.now()) { last = { code: suppression.code, retryable: false }; attempts.push({ source: candidate.source, code: last.code }); continue; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Ga4Failure('timeout');
        const client = candidate.client();
        let timeZone: string | null = null;
        const quality = { dataLossFromOtherRow: false, thresholded: false, sampled: false, truncatedRows: false };
        const inspect = (res: ReportResponse, expectedMetrics?: number) => {
          for (const row of res.rows ?? []) {
            if (expectedMetrics !== undefined && (row.metricValues?.length ?? 0) !== expectedMetrics) throw new Ga4Failure('upstream_error');
            for (const metric of row.metricValues ?? []) {
              if (metric.value == null || metric.value === '' || !Number.isFinite(Number(metric.value))) throw new Ga4Failure('upstream_error');
            }
          }
          if (Buffer.byteLength(JSON.stringify(res)) > 1048576) throw new Ga4Failure('upstream_error');
          quality.truncatedRows ||= Number(res.rowCount ?? 0) > (res.rows?.length ?? 0);
          timeZone = res.metadata?.timeZone ?? timeZone;
          quality.dataLossFromOtherRow ||= !!res.metadata?.dataLossFromOtherRow;
          quality.thresholded ||= !!res.metadata?.subjectToThresholding;
          quality.sampled ||= !!res.metadata?.samplingMetadatas?.length;
        };
        const scoped = {
          runReport: async (request: Report) => {
            const result = await client.runReport(hostFilter(scope, request), { timeout: Math.max(1, remaining - 1000), retry: null });
            inspect(result[0], request.metrics?.length); return result;
          },
          runRealtimeReport: async (request: protos.google.analytics.data.v1beta.IRunRealtimeReportRequest) => {
            if (!scope.streamId) throw new Ga4Failure('invalid_query');
            const stream = { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT' as const, value: scope.streamId } } };
            const result = await client.runRealtimeReport({ ...request, property: scope.propertyId,
              dimensionFilter: request.dimensionFilter ? { andGroup: { expressions: [stream, request.dimensionFilter] } } : stream }, { timeout: Math.max(1, remaining - 1000), retry: null });
            inspect(result[0], request.metrics?.length);
            return result;
          },
          batchRunReports: async (request: protos.google.analytics.data.v1beta.IBatchRunReportsRequest) => {
            const result = await client.batchRunReports({ ...request, property: scope.propertyId,
              requests: request.requests?.map(r => hostFilter(scope, r)) }, { timeout: Math.max(1, remaining - 1000), retry: null });
            for (const report of result[0].reports ?? []) inspect(report);
            if (Buffer.byteLength(JSON.stringify(result[0])) > 1048576) throw new Ga4Failure('upstream_error');
            return result;
          },
        } as ScopedGa4Client;
        const data = await Promise.race([work(scoped, scope.propertyId), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Ga4Failure('timeout')), remaining);
        })]);
        return { status: 'success', data, provenance: { ownerId: scope.ownerId, domainId: scope.domainId,
          bindingId: scope.bindingId, propertyId: scope.propertyId, host: scope.host, credentialSource: candidate.source,
          collectedAt: new Date().toISOString(), range: absoluteRange(range, timeZone), timeZone, queryVersion: queryKey, completeness: quality.truncatedRows ? 'partial' : 'complete', quality } };
      } catch (error) {
        last = classifyGa4Error(error);
        attempts.push({ source: candidate.source, code: last.code });
        if (last.code === 'invalid_credentials' || last.code === 'permission_denied') {
          if (suppressed.size >= 500) suppressed.delete(suppressed.keys().next().value!);
          suppressed.set(suppressionKey, { until: Date.now() + 300000, code: last.code });
        }
        if (!['invalid_credentials', 'permission_denied'].includes(last.code)) break;
      } finally { if (timer) clearTimeout(timer); }
    }
    return { status: 'error', ...last, attempts };
  })();
  inFlight.set(key, promise);
  try {
    const result = await promise;
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    if (result.status === 'success') cache.set(key, { until: Date.now() + ttl, result });
    return result;
  } finally { inFlight.delete(key); }
}

function absoluteRange(range: { startDate: string; endDate: string }, timeZone: string | null) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const resolve = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const days = value === 'today' ? 0 : value === 'yesterday' ? 1 : Number(value.match(/^(\d+)daysAgo$/)?.[1]);
    if (!Number.isFinite(days)) throw new Ga4Failure('invalid_query');
    return new Date(Date.parse(today+'T00:00:00Z') - days*86400000).toISOString().slice(0,10);
  };
  return { startDate: resolve(range.startDate), endDate: resolve(range.endDate) };
}
