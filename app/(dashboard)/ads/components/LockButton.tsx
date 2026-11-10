// app/(dashboard)/ads/components/LockButton.tsx
// 미러 엔티티 켜기·끄기(Task 12). 켜기 = locked:false + expected_lock_version(CAS). 끄기 = locked:true(서버는 버전과 무관하게 이기지만 스키마상 보낸다).
// 오류는 lockErrorView(최종 판정 B3): 끄기 요청의 실패는 원인과 무관하게 urgent "네이버 화면에서 지금 바로 직접 꺼 주세요",
// 켜기 실패는 재끄기까지 실패(details.paused=false)일 때 urgent. 문구는 페이지 배너(LockNotices, B2)로 올린다 — 배너가 없는 화면이면 셀 안에.
// 성공·실패 모두 개요를 다시 읽는다.
'use client';

import { useState } from 'react';
import type { ErrorView } from '@/lib/api/ads-format';
import { lockErrorView } from '@/lib/api/ads-safety';
import { useAdsLock } from '@/hooks/useAdsOverview';
import type { AdLockEntityType, AdMirrorBaseDTO } from '@/types/ads';
import { usePageLockNotices } from './LockNotices';
import { Notice } from './ui';

export function LockButton({ accountId, type, row }: { accountId: string; type: AdLockEntityType; row: AdMirrorBaseDTO }) {
  const lock = useAdsLock(accountId);
  const notices = usePageLockNotices();
  const [error, setError] = useState<ErrorView | null>(null);
  const turnOn = row.userLock;
  const run = () => {
    if (turnOn && !confirm(`'${row.name}'을(를) 켭니다. 켜면 광고가 노출되고 비용이 나갑니다. 계속할까요?`)) return;
    setError(null);
    lock.mutate({ type, id: row.id, locked: !turnOn, lockVersion: row.lockVersion }, {
      onError: (e) => {
        const view = lockErrorView(e, !turnOn);
        if (notices) notices.push(`${turnOn ? '켜기' : '끄기'} '${row.name}'(${row.naverId})`, view);
        else setError(view);
      },
    });
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
