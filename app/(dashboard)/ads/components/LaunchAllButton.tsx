// app/(dashboard)/ads/components/LaunchAllButton.tsx
// '제안 전체 켜기'(3.6단계): 이 제안의 꺼진 항목을 소재 → 키워드 → 광고그룹 → 캠페인 순으로 켠다(lib/api/ads-launch.ts).
// 실패하면 멈추고 이번에 켠 것을 다시 끈다. 결과 문구는 페이지 배너(LockNotices)로 올린다 — 배너가 없는 화면이면 버튼 아래에.
'use client';

import { useState } from 'react';
import type { ErrorView } from '@/lib/api/ads-format';
import { lockErrorView } from '@/lib/api/ads-safety';
import { LAUNCH_LABEL, LAUNCH_ORDER, launchResultView, planLaunch } from '@/lib/api/ads-launch';
import { useLaunchAll } from '@/hooks/useAdsOverview';
import type { AdOverviewDTO } from '@/types/ads';
import { usePageLockNotices } from './LockNotices';
import { Notice, subText } from './ui';

export function LaunchAllButton({ overview, proposalId, accountId }: { overview: AdOverviewDTO; proposalId: string; accountId: string }) {
  const launch = useLaunchAll(accountId);
  const notices = usePageLockNotices();
  const [view, setView] = useState<ErrorView | null>(null);
  const plan = planLaunch(overview, proposalId);
  const total = plan.items.length;
  if (plan.truncated) return <span style={subText}>항목이 많아 일부만 보여 전체 켜기를 할 수 없습니다.</span>;
  if (total === 0 && !launch.isPending) return view ? <Notice view={view} /> : null; // 다 켠 뒤에도 결과 문구는 남긴다
  const counts = LAUNCH_ORDER.map((t) => [t, plan.items.filter((x) => x.type === t).length] as const).filter(([, n]) => n > 0)
    .map(([t, n]) => `${LAUNCH_LABEL[t]} ${n}`).join(' · ');
  const run = () => {
    const cap = overview.account.dailyCapKrw.toLocaleString('ko-KR');
    if (!confirm(`이 제안의 꺼진 항목 ${total}개(${counts})를 차례로 켭니다. 켜면 광고가 노출되고 비용이 나갑니다(하루 상한 ${cap}원). 계속할까요?`)) return;
    setView(null);
    launch.mutate(plan.items, {
      onSuccess: (r) => {
        const v = launchResultView(r, r.failure ? lockErrorView(r.failure.error, false) : undefined);
        const next: ErrorView = { message: v.message, urgent: v.urgent, reload: false };
        if (notices) notices.push('제안 전체 켜기', next);
        else setView(next);
      },
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <button type="button" className="btn btn-primary" disabled={launch.isPending} onClick={run}>
        {launch.isPending ? `켜는 중… ${launch.done}/${total}` : `제안 전체 켜기 (${total})`}
      </button>
      <Notice view={view} />
    </div>
  );
}
