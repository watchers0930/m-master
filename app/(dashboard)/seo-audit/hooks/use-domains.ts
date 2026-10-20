// app/(dashboard)/seo-audit/hooks/use-domains.ts
// 도메인 목록 패칭 (GET /api/domains). 설계 §8: 기존 Domain 목록을 공유·선택만 한다
// (SEO 전용 등록 폼 중복 구현 금지). 생성은 기존 GEO 흐름(/visibility)에서 처리.
'use client';

import { useQuery } from '@tanstack/react-query';
import { listDomains } from '../api';

export function useDomains(enabled = true) {
  return useQuery({
    // ['visibility','domains'] 와 분리된 키 — SEO 조회가 GEO 캐시를 흔들지 않도록.
    queryKey: ['seo', 'domains'],
    queryFn: () => listDomains(),
    enabled,
  });
}
