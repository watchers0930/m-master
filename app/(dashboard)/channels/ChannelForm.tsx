// app/(dashboard)/channels/ChannelForm.tsx
// 채널 연동 화면 조립(블로그 안내·소셜 채널 카드·도움말). 상태는 훅, 카드/목록은 components/channels.
'use client';

import { useChannelCredentials } from '@/hooks/useChannelCredentials';
import { useCafeTargets } from '@/hooks/useCafeTargets';
import { CHANNELS } from '@/components/channels/channelDefs';
import ChannelCard from '@/components/channels/ChannelCard';
import type { ChannelStatus, CafeTargetData } from '@/components/channels/types';

interface Props { initial: Record<string, ChannelStatus>; cafeTargets?: CafeTargetData[] }

export default function ChannelForm({ initial, cafeTargets: initialTargets }: Props) {
  const cred = useChannelCredentials(initial);
  const cafe = useCafeTargets(initialTargets);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>채널 연동</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>소셜 미디어 채널을 연결하여 자동 발행합니다</p>
      </div>

      {/* 블로그 (항상 연결) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--blue-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="20" height="20" fill="none" stroke="var(--blue-600)" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>블로그 (HTML Export)</span>
            <span style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-200)', color: 'var(--blue-600)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>연결됨</span>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--sub)' }}>HTML 파일 다운로드 방식. 발행 버튼 클릭 시 og/meta/schema 포함된 HTML 생성.</p>
        </div>
      </div>

      {/* 소셜 채널 카드 */}
      {CHANNELS.map(ch => (
        <ChannelCard
          key={ch.id}
          ch={ch}
          st={cred.statuses[ch.id]}
          isLoading={cred.loading[ch.id] ?? false}
          error={cred.errors[ch.id] ?? ''}
          ok={cred.success[ch.id] ?? ''}
          formValues={cred.forms[ch.id] ?? {}}
          cafe={cafe}
          onField={cred.setField}
          onConnect={cred.handleConnect}
          onDisconnect={cred.handleDisconnect}
        />
      ))}

      {/* 도움말 */}
      <div style={{ display: 'flex', gap: 8, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 8, padding: '10px 14px', fontSize: 11.5, color: 'var(--blue-700)' }}>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p style={{ margin: 0 }}>각 채널의 API 키를 입력하면 토큰 유효성을 실시간 검증합니다.</p>
          <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--sub)' }}>
            Instagram/Facebook: Meta Graph API Explorer에서 장기 토큰 발급 &nbsp;|&nbsp;
            네이버: 네이버 개발자센터 &gt; 애플리케이션 &gt; 카페 API 설정
          </p>
        </div>
      </div>
    </div>
  );
}
