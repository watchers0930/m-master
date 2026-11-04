// hooks/useOwnedDomains.ts
// 소유 도메인 목록 (GET /api/domains). GA4 도메인 선택·자동화 도메인 선택이 공용으로 쓴다.
// 쿼리키는 가시성 화면과 같은 ['visibility','domains'] — 같은 데이터·캐시를 공유하고,
// 공통 useCreateDomain 의 무효화 대상에 이미 포함돼 있어 등록 즉시 반영된다.
'use client';

import { useQuery } from '@tanstack/react-query';
import { listDomains } from '@/lib/api/domains';

export function useOwnedDomains(enabled = true) {
  return useQuery({
    queryKey: ['visibility', 'domains'],
    queryFn: () => listDomains(),
    enabled,
  });
}
