import type { ConsultingSnapshot, EvidenceRef } from '@/types/consulting';
import type { Ga4Collection } from './ga4-collect';
import { GA4_REPORTS, type ReportName } from './ga4-collect';
const reportLabels: Record<string,string> = { channels:'유입 채널',sourceMedium:'유입 소스·매체',landing:'방문 시작 페이지',pages:'페이지',events:'이벤트' };
const labels: Record<string,string> = { activeUsers: '활성 사용자', sessions: '세션', engagedSessions: '참여 세션',
  engagementRate: '참여율', keyEvents: '주요 이벤트', screenPageViews: '페이지 조회', userEngagementDuration: '참여 시간', eventCount: '이벤트 수' };
export function ga4Limitation(code: string): string {
  return ({ upstream_error:'GA4 서버 응답 오류', invalid_credentials:'GA4 인증 정보 확인 필요', credential_storage_error:'GA4 관리자 설정 오류(자격증명 키) — 운영자 확인 필요',
    permission_denied:'GA4 조회 권한 확인 필요', quota_exceeded:'GA4 조회 한도 초과', timeout:'GA4 조회 시간 초과',
    invalid_query:'GA4 조회 조건 확인 필요', not_configured:'GA4 연결 미설정', unmapped:'GA4 도메인 매핑 필요',
    domain_required:'GA4 조회 도메인 선택 필요', binding_disabled:'GA4 연결 비활성화' } as Record<string,string>)[code] ?? 'GA4 데이터를 확인하지 못했습니다.';
}
export function ga4Evidence(result: Ga4Collection): Pick<ConsultingSnapshot, 'evidence' | 'sourceStatus' | 'limitations' | 'ga4'> {
  if (result.status !== 'success') return { evidence: [], limitations: [ga4Limitation(result.status === 'error' ? result.code : result.reason)],
    sourceStatus: [{ source: 'ga4', status: result.status === 'error' ? 'error' : result.reason === 'unmapped' ? 'unmapped' : 'missing', observedAt: null,
      reason: result.status === 'error' ? result.code : result.reason }] };
  const { provenance, reports, failedQueries } = result.data;
  const evidence: EvidenceRef[] = [], limitations: string[] = [];
  const add = (report: string, index: string | number, key: string, value: number | null, label: string) => {
    evidence.push({ id: `ga4_${report}_${index}_${key}`, source: 'ga4', label: label.slice(0,600),
      value: value === null ? null : key === 'engagementRate' ? value * 100 : value,
      unit: key === 'engagementRate' ? '%' : key === 'userEngagementDuration' ? '초' : key === 'activeUsers' ? '명' : '회',
      observedAt: provenance.collectedAt, rangeFrom: provenance.range.startDate + 'T00:00:00.000Z', rangeTo: provenance.range.endDate + 'T23:59:59.999Z' });
  };
  for (const name of Object.keys(GA4_REPORTS) as ReportName[]) {
    reports[name].forEach((row, index) => {
      const label = name === 'events' && row.key === 'form_start' ? '폼 시작 이벤트' : row.key;
      for (const key of GA4_REPORTS[name].metrics) add(name, index, key, (row as unknown as Record<string,number|null>)[key], `${label} ${labels[key]}`);
    });
    if (name !== 'sourceMedium') {
      const total = reports.totals[name];
      if (total) for (const [key,value] of Object.entries(total)) add(name, 'total', key, value, `GA4 ${reportLabels[name]} 전체 ${labels[key]}`);
    }
  }
  if (failedQueries.length) limitations.push(`GA4 부분 수집: ${failedQueries.map(q => reportLabels[q.report]).join(', ')}`);
  if (provenance.quality.thresholded || provenance.quality.sampled) limitations.push('GA4 임계값 또는 표본 추출이 적용되어 관측이 제한됩니다.');
  if (provenance.quality.dataLossFromOtherRow) limitations.push('GA4 기타 행 집계에 따른 데이터 손실 가능성이 있습니다.');
  if (provenance.timeZone && provenance.timeZone !== 'UTC') limitations.push(`GA4는 속성 시간대(${provenance.timeZone}) 기준 일자로 집계`);
  return { ga4: result.data, evidence, limitations, sourceStatus: [{ source: 'ga4',
    status: failedQueries.length ? 'partial' : 'available', observedAt: provenance.collectedAt, reason: null }] };
}
