// app/(dashboard)/ads/components/LockButton.tsx
// 미러 엔티티 켜기·끄기(Task 12). 켜기 = locked:false + expected_lock_version(CAS). 끄기 = locked:true(서버는 버전과 무관하게 이기지만 스키마상 보낸다).
// 오류는 errorView — 502 pause_unconfirmed는 "네이버 화면에서 지금 바로 직접 꺼 주세요"를 크게(urgent). 성공·실패 모두 개요를 다시 읽는다.
'use client';

import { useState } from 'react';
import { errorView, type ErrorView } from '@/lib/api/ads-format';
import { useAdsLock } from '@/hooks/useAdsOverview';
import type { AdLockEntityType, AdMirrorBaseDTO } from '@/types/ads';
import { Notice } from './ui';

export function LockButton({ accountId, type, row }: { accountId: string; type: AdLockEntityType; row: AdMirrorBaseDTO }) {
  const lock = useAdsLock(accountId);
  const [error, setError] = useState<ErrorView | null>(null);
  const turnOn = row.userLock;
  const run = () => {
    if (turnOn && !confirm(`'${row.name}'을(를) 켭니다. 켜면 광고가 노출되고 비용이 나갑니다. 계속할까요?`)) return;
    setError(null);
    lock.mutate({ type, id: row.id, locked: !turnOn, lockVersion: row.lockVersion }, { onError: (e) => setError(errorView(e)) });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <button type="button" className={turnOn ? 'btn btn-primary' : 'btn btn-ghost'} disabled={lock.isPending} onClick={run}>
        {lock.isPending ? '처리 중…' : turnOn ? '켜기' : '끄기'}
      </button>
      <Notice view={error} />
    </div>
  );
}
