// hooks/useGa4Settings.ts
// 설정 화면 GA4 연결 상태·해제·자동화 도메인 저장 (GA4 설계 §4.6).
// 바인딩 유효성·소유 검증은 서버 책임. 변경 후에는 서버 상태를 다시 읽는다(낙관 갱신 없음).
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { disconnectGa4Oauth, getGa4Settings, saveAutomationDomain } from '@/lib/api/ga4-settings';
import { ga4QueryKeys, invalidateGa4Data } from '@/hooks/ga4QueryKeys';

export function useGa4Settings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ga4QueryKeys.settings, queryFn: getGa4Settings, retry: false });
  // 자동화 도메인·연결이 바뀌면 'default' 도메인 키의 의미가 바뀐다 → GA4 데이터 캐시 전체 무효화
  const refresh = () => invalidateGa4Data(qc);

  const disconnect = useMutation({ mutationFn: disconnectGa4Oauth, onSettled: refresh });
  const setAutomationDomain = useMutation({
    mutationFn: (domainId: string | null) => saveAutomationDomain(domainId),
    onSettled: refresh,
  });

  return { query, disconnect, setAutomationDomain };
}
