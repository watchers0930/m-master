// app/(dashboard)/visibility/hooks/use-visibility-data.ts
// 집계 데이터 패칭·상태 (GET /api/visibility/data). 표시 로직은 components/ 담당.
'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchVisibilityData, type VisibilityDataFilters } from '../api';

export function useVisibilityData(filters: VisibilityDataFilters, enabled = true) {
  return useQuery({
    queryKey: ['visibility', 'data', filters],
    queryFn: () => fetchVisibilityData(filters),
    enabled,
  });
}
