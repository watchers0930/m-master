// app/(dashboard)/visibility/hooks/use-domains.ts
// 도메인 목록·생성 패칭·상태 (GET·POST /api/domains). 질문 생성 시 소유 도메인 연결용.
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listDomains, createDomain, type CreateDomainBody } from '../api';

export function useDomains(enabled = true) {
  return useQuery({
    queryKey: ['visibility', 'domains'],
    queryFn: () => listDomains(),
    enabled,
  });
}

export function useCreateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDomainBody) => createDomain(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visibility', 'domains'] }),
  });
}
