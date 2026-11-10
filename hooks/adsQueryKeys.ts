// hooks/adsQueryKeys.ts
// 광고 화면 쿼리키 단일 출처(Task 12). 모든 키는 ['ads'] 접두사 아래 — 계정 해제·연결처럼 넓은 변경은 접두사 전체를 무효화한다.
import type { QueryClient } from '@tanstack/react-query';
import type { AdsProposalListQuery } from '@/lib/api/ads';

export const adsQueryKeys = {
  all: ['ads'] as const,
  accounts: ['ads', 'accounts'] as const,
  /** 계정 상세 + 비즈채널(네이버 조회 1회) — 대장이 '채널 불러오기'를 눌렀을 때만 */
  accountChannels: (id: string) => ['ads', 'account-channels', id] as const,
  overview: (id: string) => ['ads', 'overview', id] as const,
  proposals: (q: Omit<AdsProposalListQuery, 'cursor'>) => ['ads', 'proposals', q] as const,
  proposalsAll: ['ads', 'proposals'] as const,
  proposal: (id: string) => ['ads', 'proposal', id] as const,
};

/** 계정 변경 후: 모든 광고 캐시를 다시 읽는다. 비즈채널 목록(네이버 조회)은 제외 — 대장이 버튼으로만 다시 부른다(중복 호출 방지). */
export const invalidateAds = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: adsQueryKeys.all, predicate: (q) => q.queryKey[1] !== 'account-channels' });
