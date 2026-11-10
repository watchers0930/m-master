// app/(dashboard)/ads/components/AccountCard.tsx
// 연결된 광고 계정 1개(Task 12): 상태(키 끝 4자리만) · 상한 · 비즈채널 선택 · 키 교체 · 해제.
// - 비즈채널 목록은 네이버를 부른다 → '채널 불러오기'를 눌렀을 때만(연결 직후에는 연결 응답의 목록을 쓴다).
// - 해제: 확인 → 진행 표시(모든 캠페인을 끄고 다시 확인) → 확인 못 하면 중단·키 유지 사유 안내(disconnect_incomplete).
'use client';

import { useState, type FormEvent } from 'react';
import { errorView, formatKrw, type ErrorView } from '@/lib/api/ads-format';
import { useAdsAccountChannels, useAdsAccountMutations } from '@/hooks/useAdsAccounts';
import type { AdAccountDTO } from '@/types/ads';
import { accountStatusText } from './AccountPicker';
import { ChannelPicker } from './ChannelPicker';
import { EMPTY_KEYS, KeyFields, type KeyValues } from './KeyFields';
import { Card, Notice, info, subText } from './ui';

function ReplaceKeys({ account }: { account: AdAccountDTO }) {
  const { replaceKeys } = useAdsAccountMutations();
  const [keys, setKeys] = useState<KeyValues>(EMPTY_KEYS);
  const [notice, setNotice] = useState<{ view: ErrorView; ok: boolean } | null>(null);
  const ready = keys.apiKey.length >= 16 && keys.secretKey.length >= 16;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || replaceKeys.isPending) return;
    const v = { id: account.id, ...keys };
    setKeys(EMPTY_KEYS);
    setNotice(null);
    replaceKeys.mutate(v, {
      onSuccess: (a) => setNotice({ view: info(`새 키로 바꿨습니다(키 끝 ${a.keyLast4}).`), ok: true }),
      onError: (err) => setNotice({ view: errorView(err), ok: false }),
    });
  };
  return (
    <form onSubmit={submit} autoComplete="off" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      <KeyFields value={keys} onChange={setKeys} disabled={replaceKeys.isPending} />
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="submit" className="btn btn-teal" disabled={!ready || replaceKeys.isPending}>{replaceKeys.isPending ? '네이버에서 확인 중…' : '키 교체'}</button>
        <span style={subText}>새 키가 네이버 확인을 통과해야만 바뀝니다.</span>
      </div>
      {notice && <div style={{ gridColumn: '1 / -1' }}><Notice view={notice.view} tone={notice.ok ? 'ok' : 'error'} /></div>}
    </form>
  );
}

export function AccountCard({ account }: { account: AdAccountDTO }) {
  const { disconnect } = useAdsAccountMutations();
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [notice, setNotice] = useState<{ view: ErrorView; ok: boolean } | null>(null);
  const channels = useAdsAccountChannels(account.id, channelsOpen && account.status === 'active');
  const usable = account.connected && account.status !== 'disconnecting';

  const runDisconnect = () => {
    if (!confirm(`'${account.label}' 연결을 해제합니다. 이 계정의 모든 캠페인을 네이버에서 끄고 확인한 뒤 키를 삭제합니다. 계속할까요?`)) return;
    setNotice(null);
    disconnect.mutate(account.id, {
      onSuccess: () => setNotice({ view: info('해제했습니다. 모든 캠페인이 꺼진 것을 확인했고 키를 삭제했습니다.'), ok: true }),
      onError: (err) => setNotice({ view: errorView(err), ok: false }),
    });
  };

  return (
    <Card title={`${account.label} · ${account.naverCustomerId}`} right={<span style={{ fontSize: 12, fontWeight: 700, color: account.connected && account.status === 'active' ? 'var(--green-700)' : 'var(--amber-700)' }}>{accountStatusText(account)}</span>}>
      <div style={subText}>
        하루 상한 {formatKrw(account.dailyCapKrw)} · 공유예산 {formatKrw(account.sharedBudgetKrw)} · 입찰 상한 {formatKrw(account.maxBidKrw)} ·
        공유예산 {account.sharedBudgetId ? '연결됨' : '없음'} · 비즈채널 {account.businessChannelId ?? '선택 전'}
      </div>
      {disconnect.isPending && <Notice view={info('해제 중입니다 — 네이버에서 모든 캠페인을 끄고 다시 확인하는 중입니다. 창을 닫지 마세요.')} tone="info" />}
      {notice && <Notice view={notice.view} tone={notice.ok ? 'ok' : 'error'} />}
      {usable && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {account.status === 'active' && (
              <button type="button" className="btn btn-ghost" disabled={channels.isFetching} onClick={() => { setChannelsOpen(true); if (channelsOpen) void channels.refetch(); }}>
                {channels.isFetching ? '채널 불러오는 중…' : channels.data ? '채널 다시 불러오기' : '비즈채널 불러오기'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setShowKeys((v) => !v)}>{showKeys ? '키 교체 닫기' : '키 교체'}</button>
            <button type="button" className="btn btn-ghost" style={{ color: '#b91c1c', borderColor: '#fecaca' }} disabled={disconnect.isPending} onClick={runDisconnect}>
              {disconnect.isPending ? '해제 중…' : '연결 해제'}
            </button>
          </div>
          {channels.error && <Notice view={errorView(channels.error)} />}
          {channels.data && <ChannelPicker accountId={account.id} channels={channels.data.channels} current={account.businessChannelId} />}
          {showKeys && <ReplaceKeys account={account} />}
        </>
      )}
    </Card>
  );
}
