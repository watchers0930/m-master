// app/(dashboard)/components/domain/use-create-domain.ts
// 공통 도메인 등록 훅. 어느 분석 화면에서 등록해도 세 화면(가시성·SEO·컨설팅)의
// 도메인 목록 캐시를 모두 무효화해 목록 정합성을 유지한다(화면 간 즉시 반영).
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createDomain, type CreateDomainBody } from './api';

// 각 화면이 쓰는 도메인 쿼리키 prefix. invalidateQueries 는 prefix 일치(exact:false)로
// ['consulting','domains', q] 같은 파생 키까지 함께 무효화한다.
const DOMAIN_QUERY_PREFIXES: readonly (readonly string[])[] = [
  ['visibility', 'domains'],
  ['seo', 'domains'],
  ['consulting', 'domains'],
];

export function useCreateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDomainBody) => createDomain(body),
    onSuccess: () => {
      for (const key of DOMAIN_QUERY_PREFIXES) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
