// hooks/ga4QueryKeys.ts
// GA4 쿼리키 단일 출처. 모든 GA4 데이터 키는 ga4QueryKeys.data 접두사 아래에 둔다 —
// 도메인 미지정('default')은 서버가 "자동화 도메인"으로 해석하므로, 설정(자동화 도메인·연결 해제)이 바뀌면
// 같은 키가 다른 데이터를 뜻하게 된다. 그래서 설정 변경 시 data 접두사 전체를 무효화한다(invalidateGa4Data).
import type { QueryClient } from '@tanstack/react-query';

const dom = (domainId: string | null) => domainId ?? 'default';

export const ga4QueryKeys = {
  settings: ['ga4', 'settings'] as const,
  data: ['ga4', 'data'] as const,
  dowPattern: (domainId: string | null) => ['ga4', 'data', 'analytics', 'ga4-pattern', dom(domainId)] as const,
  contentPerformance: (days: number, domainId: string | null) => ['ga4', 'data', 'analytics', 'content-performance', days, dom(domainId)] as const,
  visitors: (period: string, domainId: string | null) => ['ga4', 'data', 'visitors', 'data', period, dom(domainId)] as const,
  realtime: (domainId: string | null) => ['ga4', 'data', 'visitors', 'realtime', dom(domainId)] as const,
  abTest: (id: string) => ['ga4', 'data', 'ab-test', id] as const,
};

/** GA4 연결·자동화 도메인 변경 후: 설정 + 모든 GA4 데이터 캐시를 서버 기준으로 다시 읽는다 */
export function invalidateGa4Data(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ga4QueryKeys.settings }),
    qc.invalidateQueries({ queryKey: ga4QueryKeys.data }),
  ]);
}
