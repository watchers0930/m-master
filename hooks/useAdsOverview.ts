// hooks/useAdsOverview.ts
// 광고 계정 개요(GET /api/ads/accounts/[id]/overview — DB만, 네이버 호출 없음)와 켜기·끄기(Task 12).
// 켜기·끄기는 성공·실패 모두 개요를 다시 읽는다(실패해도 서버가 의도를 기록했을 수 있다 — 끄기는 의도를 먼저 기록한다).
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdOverview, setAdLock } from '@/lib/api/ads';
import { adsQueryKeys } from '@/hooks/adsQueryKeys';
import type { AdLockEntityType } from '@/types/ads';

export function useAdsOverview(accountId: string | null) {
  return useQuery({
    queryKey: adsQueryKeys.overview(accountId ?? ''),
    queryFn: () => getAdOverview(accountId as string),
    enabled: !!accountId,
    retry: false,
  });
}

export type LockVars = { type: AdLockEntityType; id: string; locked: boolean; lockVersion: number };

export function useAdsLock(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: LockVars) => setAdLock(v.type, v.id, v.locked, v.lockVersion),
    onSettled: () => qc.invalidateQueries({ queryKey: adsQueryKeys.overview(accountId ?? '') }),
  });
}
