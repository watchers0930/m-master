'use client';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listDomains, fetchDomain } from '../api';
export function useDomains(search: string) {
  const [q, setQ] = useState(search);
  useEffect(() => { const timer = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  return useInfiniteQuery({
    queryKey: ['consulting', 'domains', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listDomains(q, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
}
export function useDomain(id: string | null) {
  return useQuery({ queryKey: ['consulting', 'domain', id],
    queryFn: ({ signal }) => fetchDomain(id!, signal), enabled: !!id, retry: false });
}
