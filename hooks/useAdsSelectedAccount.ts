// hooks/useAdsSelectedAccount.ts
// 광고 화면에서 보고 있는 계정(Task 12). 기본 = 연결된 첫 계정, 없으면 첫 계정. 고른 계정이 목록에서 사라지면 기본으로 돌아간다.
// 마지막 선택은 브라우저에만(편의, 실패해도 기본값으로 동작).
'use client';

import { useMemo, useState } from 'react';
import type { AdAccountDTO } from '@/types/ads';

const STORE_KEY = 'ads.selectedAccount';

function readStored(): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(STORE_KEY); } catch { return null; }
}

export function useAdsSelectedAccount(accounts: AdAccountDTO[] | undefined) {
  const [picked, setPicked] = useState<string | null>(readStored);
  const selected = useMemo(() => {
    const list = accounts ?? [];
    return list.find((a) => a.id === picked) ?? list.find((a) => a.connected) ?? list[0] ?? null;
  }, [accounts, picked]);
  const select = (id: string) => {
    setPicked(id);
    try { window.localStorage.setItem(STORE_KEY, id); } catch { /* 저장 못 해도 이번 화면에서는 유지 */ }
  };
  return { selected, select };
}
