// hooks/useAdsAccounts.ts
// 광고 계정 목록·연결·키 교체·비즈채널 선택·해제(Task 12). 변경 후에는 서버 상태를 다시 읽는다(낙관 갱신 없음).
// 키는 mutation 변수로 지나간다. TanStack Query는 그 변수를 mutation 상태(variables)·MutationCache에 보관하므로
// 연결·키 교체는 gcTime 0(관찰자가 없으면 즉시 캐시에서 제거) + 폼이 끝나면 reset()(관찰 중 상태에서도 제거)으로 남기지 않는다(최종 판정 B5).
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  connectAdAccount, disconnectAdAccount, getAdAccount, listAdAccounts, replaceAdKeys, selectAdChannel, type AdsConnectBody,
} from '@/lib/api/ads';
import { adsQueryKeys, invalidateAds } from '@/hooks/adsQueryKeys';

export function useAdsAccounts() {
  return useQuery({ queryKey: adsQueryKeys.accounts, queryFn: listAdAccounts, retry: false });
}

/** 비즈채널 목록은 네이버를 부른다 → enabled일 때만(버튼으로 연다). */
export function useAdsAccountChannels(id: string, enabled: boolean) {
  return useQuery({ queryKey: adsQueryKeys.accountChannels(id), queryFn: () => getAdAccount(id), enabled, retry: false, staleTime: 0 });
}

export function useAdsAccountMutations() {
  const qc = useQueryClient();
  const refresh = () => invalidateAds(qc);
  const connect = useMutation({
    gcTime: 0,
    mutationFn: (input: AdsConnectBody) => connectAdAccount(input),
    onSuccess: (result) => qc.setQueryData(adsQueryKeys.accountChannels(result.account.id), result),
    onSettled: refresh,
  });
  const replaceKeys = useMutation({
    gcTime: 0,
    mutationFn: (v: { id: string; apiKey: string; secretKey: string }) => replaceAdKeys(v.id, { apiKey: v.apiKey, secretKey: v.secretKey }),
    onSettled: refresh,
  });
  const selectChannel = useMutation({
    mutationFn: (v: { id: string; channelId: string }) => selectAdChannel(v.id, v.channelId),
    onSettled: refresh,
  });
  const disconnect = useMutation({ mutationFn: (id: string) => disconnectAdAccount(id), onSettled: refresh });
  return { connect, replaceKeys, selectChannel, disconnect };
}
