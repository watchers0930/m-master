// hooks/useAdsOverview.ts
// 광고 계정 개요(GET /api/ads/accounts/[id]/overview — DB만, 네이버 호출 없음)와 켜기·끄기(Task 12).
// 제안 전체 켜기(useLaunchAll)는 같은 켜기 API를 항목마다 부른다(lib/api/ads-launch.ts).
// 켜기·끄기는 성공·실패 모두 개요를 다시 읽는다(실패해도 서버가 의도를 기록했을 수 있다 — 끄기는 의도를 먼저 기록한다).
'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdOverview, setAdLock } from '@/lib/api/ads';
import { adsQueryKeys } from '@/hooks/adsQueryKeys';
import { runLaunch, type LaunchItem } from '@/lib/api/ads-launch';
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

/** 제안 전체 켜기(lib/api/ads-launch.ts) — 항목마다 기존 켜기 API를 순서대로 부른다. 끝나면(성공·실패 모두) 개요를 다시 읽는다. */
export function useLaunchAll(accountId: string | null) {
  const qc = useQueryClient();
  const [done, setDone] = useState(0);
  const mutation = useMutation({
    mutationFn: (items: LaunchItem[]) => {
      setDone(0);
      // 되돌리기 직전 현재 버전(다른 탭·감시가 바꾼 항목은 건드리지 않게) — 개요 1회 조회
      const current = async () => {
        const o = await getAdOverview(accountId as string);
        const rows = [...o.campaigns.map((r) => ['campaign', r] as const), ...o.groups.map((r) => ['adgroup', r] as const),
          ...o.keywords.map((r) => ['keyword', r] as const), ...o.ads.map((r) => ['ad', r] as const)];
        return new Map(rows.map(([t, r]) => [`${t}:${r.id}`, r.lockVersion]));
      };
      return runLaunch(items, setAdLock, setDone, current);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: adsQueryKeys.overview(accountId ?? '') }),
  });
  return { ...mutation, done };
}
