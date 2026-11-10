// hooks/useAdsAccounts.ts
// 광고 계정 목록·연결·키 교체·비즈채널 선택·해제(Task 12). 변경 후에는 서버 상태를 다시 읽는다(낙관 갱신 없음).
// 키는 mutation 변수로만 지나간다 — 캐시·상태에 남기지 않는다(폼이 제출 직후 지운다).
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
    mutationFn: (input: AdsConnectBody) => connectAdAccount(input),
    onSuccess: (result) => qc.setQueryData(adsQueryKeys.accountChannels(result.account.id), result),
    onSettled: refresh,
  });
  const replaceKeys = useMutation({
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
