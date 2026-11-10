// app/(dashboard)/ads/components/ChannelPicker.tsx
// 비즈채널 고르기(Task 12): PC·모바일 검수가 모두 APPROVED|ELIGIBLE인 사이트 채널만 고를 수 있다. 검수 중 채널은 사유와 함께 잠가 보인다.
// 서버도 선택 시점에 네이버에서 다시 확인한다(409 channel_not_approved).
'use client';

import { useState } from 'react';
import { channelNote, errorView, inspectLabel, type ErrorView } from '@/lib/api/ads-format';
import { useAdsAccountMutations } from '@/hooks/useAdsAccounts';
import type { AdChannelDTO } from '@/types/ads';
import { Empty, Notice, subText } from './ui';

export function ChannelPicker({ accountId, channels, current }: { accountId: string; channels: AdChannelDTO[]; current: string | null }) {
  const { selectChannel } = useAdsAccountMutations();
  const [error, setError] = useState<ErrorView | null>(null);
  if (channels.length === 0) return <Empty>사이트 비즈채널이 없습니다. 네이버 광고 화면에서 채널을 등록하고 검수를 받은 뒤 다시 불러오세요.</Empty>;
  const pick = (channelId: string) => {
    setError(null);
    selectChannel.mutate({ id: accountId, channelId }, { onError: (e) => setError(errorView(e)) });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {channels.map((c) => {
        const note = channelNote(c);
        const chosen = c.id === current;
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${chosen ? 'var(--blue-300)' : 'var(--border)'}`, borderRadius: 8, opacity: c.selectable ? 1 : 0.7 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.name ?? c.id}{chosen ? ' · 선택됨' : ''}</span>
              <span style={subText}>{c.url ?? '—'} · PC {inspectLabel(c.pcInspectStatus)} · 모바일 {inspectLabel(c.mobileInspectStatus)}</span>
              {note && <span style={{ fontSize: 12, color: 'var(--amber-700)' }}>{note}</span>}
            </div>
            <button type="button" className="btn btn-ghost" disabled={!c.selectable || chosen || selectChannel.isPending} onClick={() => pick(c.id)}>
              {selectChannel.isPending && selectChannel.variables?.channelId === c.id ? '확인 중…' : '선택'}
            </button>
          </div>
        );
      })}
      <Notice view={error} />
    </div>
  );
}
