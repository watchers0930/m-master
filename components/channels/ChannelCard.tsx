// components/channels/ChannelCard.tsx
// 소셜 채널 1개 카드(헤더·상태·카페 타겟·미연결 시 입력 폼). 상태·호출은 부모(훅)가 주입.
'use client';

import type { useCafeTargets } from '@/hooks/useCafeTargets';
import type { ChannelDef } from './channelDefs';
import type { ChannelStatus } from './types';
import { inputStyle } from './inputStyle';
import Badge from './Badge';
import CafeTargetList from './CafeTargetList';

interface Props {
  ch: ChannelDef;
  st?: ChannelStatus;
  isLoading: boolean;
  error: string;
  ok: string;
  formValues: Record<string, string>;
  cafe: ReturnType<typeof useCafeTargets>;
  onField: (channelId: string, key: string, value: string) => void;
  onConnect: (channelId: string) => void;
  onDisconnect: (channelId: string) => void;
}

export default function ChannelCard({ ch, st, isLoading, error, ok, formValues, cafe, onField, onConnect, onDisconnect }: Props) {
  const connected = st?.connected ?? false;
  const masked = st?.masked ?? {};

  return (
      <div key={ch.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {/* 카드 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: connected ? ch.bgConnected : 'var(--n50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {ch.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{ch.label}</span>
              {st?.error ? (
                <span role="alert" style={{ background: '#FEECEC', border: '1px solid #F5B5B5', color: '#B42318', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>{st.recoverable ? '자격증명 키 오류 — 연결 해제 후 다시 연결하세요' : '자격증명 키 오류 — 관리자에게 문의'}</span>
              ) : <Badge connected={connected} />}
            </div>
            {connected && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {Object.entries(masked).map(([k, v]) => (
                  <span key={k} style={{ fontSize: 12, color: 'var(--sub)', fontFamily: 'monospace', background: 'var(--n50)', padding: '1px 6px', borderRadius: 3 }}>
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}
          </div>
          {connected && (!st?.error || st.recoverable) && ( /* 키 오류 행은 정본 키일 때만 해제(복구) 허용 */
            <button className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }} onClick={() => onDisconnect(ch.id)} disabled={isLoading}>
              연결 해제
            </button>
          )}
        </div>

        {/* 카페 타겟 관리 (네이버 카페 연결 시만) */}
        {ch.id === 'naver_cafe' && connected && <CafeTargetList {...cafe} />}

        {/* 미연결 시 입력 폼 */}
        {!connected && (
          <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border2)' }}>
            <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 12 }}>
              아래 정보를 입력한 후 연결 확인 버튼을 클릭하세요.
            </p>
            {ch.fields.map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 3, display: 'block' }}>
                  {f.label} {f.required && <span style={{ color: '#dc2626' }}>*</span>}
                </label>
                <input
                  type={f.secret ? 'password' : 'text'}
                  placeholder={f.placeholder}
                  value={formValues[f.key] ?? ''}
                  onChange={e => onField(ch.id, f.key, e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
            ))}
            {error && (
              <div style={{ fontSize: 11, color: '#dc2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '6px 10px' }}>
                {error}
              </div>
            )}
            {ok && (
              <div style={{ fontSize: 11, color: '#16A34A', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, padding: '6px 10px' }}>
                {ok}
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start', marginTop: 4 }}
              onClick={() => onConnect(ch.id)}
              disabled={isLoading}
            >
              {isLoading ? '검증 중...' : '연결 확인'}
            </button>
          </div>
        )}
      </div>
  );
}
