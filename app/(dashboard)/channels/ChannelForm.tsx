'use client';

import { useState, useCallback } from 'react';

// ── 타입 ─────────────────────────────────────────────────────────────
interface ChannelStatus { connected: boolean; masked?: Record<string, string> }
interface CafeTargetData { id: string; name: string; clubId: string; menuId: string; isDefault: boolean }
interface Props { initial: Record<string, ChannelStatus>; cafeTargets?: CafeTargetData[] }

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
}

const CHANNELS: { id: string; label: string; color: string; bgConnected: string; fields: FieldDef[]; icon: React.ReactNode }[] = [
  {
    id: 'naver_cafe', label: '네이버 카페', color: '#03C75A', bgConnected: '#E8F5E9',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="#03C75A"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>,
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: '네이버 개발자센터 앱 Client ID' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: '앱 Client Secret', secret: true },
      { key: 'accessToken', label: 'Access Token', placeholder: 'OAuth 2.0 Access Token', secret: true, required: true },
      { key: 'refreshToken', label: 'Refresh Token', placeholder: 'OAuth 2.0 Refresh Token (선택)', secret: true },
      { key: 'clubId', label: '카페 ID', placeholder: '카페 고유 ID (숫자)', required: true },
      { key: 'menuId', label: '게시판 메뉴 ID', placeholder: '게시판 메뉴 ID (숫자)', required: true },
    ],
  },
  {
    id: 'instagram', label: 'Instagram', color: '#E1306C', bgConnected: '#FCE4EC',
    icon: <svg width="20" height="20" fill="#E1306C" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>,
    fields: [
      { key: 'accessToken', label: 'Access Token', placeholder: 'Instagram Graph API 장기 토큰 (60일)', secret: true, required: true },
      { key: 'businessId', label: 'Business Account ID', placeholder: 'IG Business Account ID', required: true },
    ],
  },
  {
    id: 'facebook', label: 'Facebook', color: '#1877F2', bgConnected: '#E3F2FD',
    icon: <svg width="20" height="20" fill="#1877F2" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>,
    fields: [
      { key: 'accessToken', label: 'Access Token', placeholder: '페이지 액세스 토큰 (pages_manage_posts 권한)', secret: true, required: true },
      { key: 'pageId', label: 'Page ID', placeholder: 'Facebook Page ID', required: true },
    ],
  },
];

// ── 뱃지 ─────────────────────────────────────────────────────────────
function Badge({ connected }: { connected: boolean }) {
  if (connected) return <span style={{ background: '#E8F5E9', border: '1px solid #A5D6A7', color: '#2E7D32', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>연결됨</span>;
  return <span style={{ background: 'var(--n100)', color: 'var(--sub)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>미연결</span>;
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function ChannelForm({ initial, cafeTargets: initialTargets }: Props) {
  const [statuses, setStatuses] = useState(initial);
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, string>>({});

  // 카페 타겟 상태
  const [targets, setTargets] = useState<CafeTargetData[]>(initialTargets ?? []);
  const [targetForm, setTargetForm] = useState({ name: '', clubId: '', menuId: '' });
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState('');

  const setField = useCallback((channelId: string, key: string, value: string) => {
    setForms(prev => ({ ...prev, [channelId]: { ...prev[channelId], [key]: value } }));
  }, []);

  // ── 연결 ──
  const handleConnect = useCallback(async (channelId: string) => {
    const fields = forms[channelId] ?? {};
    setLoading(prev => ({ ...prev, [channelId]: true }));
    setErrors(prev => ({ ...prev, [channelId]: '' }));
    setSuccess(prev => ({ ...prev, [channelId]: '' }));

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelId, ...fields }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [channelId]: json.error?.message ?? '연결 실패' }));
        return;
      }
      setSuccess(prev => ({ ...prev, [channelId]: json.data?.message ?? '연결 완료' }));
      // 상태 갱신
      const masked: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string' && v.length > 0) {
          masked[k] = v.length < 6 ? '***' : v.slice(0, 4) + '****' + v.slice(-3);
        }
      }
      setStatuses(prev => ({ ...prev, [channelId]: { connected: true, masked } }));
      setForms(prev => ({ ...prev, [channelId]: {} }));
    } catch {
      setErrors(prev => ({ ...prev, [channelId]: '네트워크 오류' }));
    } finally {
      setLoading(prev => ({ ...prev, [channelId]: false }));
    }
  }, [forms]);

  // ── 연결 해제 ──
  const handleDisconnect = useCallback(async (channelId: string) => {
    if (!confirm('이 채널 연결을 해제하시겠습니까?')) return;
    setLoading(prev => ({ ...prev, [channelId]: true }));
    try {
      await fetch('/api/channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelId }),
      });
      setStatuses(prev => ({ ...prev, [channelId]: { connected: false } }));
      setSuccess(prev => ({ ...prev, [channelId]: '' }));
    } catch {
      setErrors(prev => ({ ...prev, [channelId]: '해제 실패' }));
    } finally {
      setLoading(prev => ({ ...prev, [channelId]: false }));
    }
  }, []);

  // ── 카페 타겟 핸들러 ──
  const handleAddTarget = useCallback(async () => {
    if (!targetForm.name || !targetForm.clubId || !targetForm.menuId) {
      setTargetError('모든 필드를 입력하세요');
      return;
    }
    setTargetLoading(true);
    setTargetError('');
    try {
      const res = await fetch('/api/cafe-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetForm),
      });
      const json = await res.json();
      if (!res.ok) { setTargetError(json.error?.message ?? '추가 실패'); return; }
      setTargets(prev => [...prev, json.data]);
      setTargetForm({ name: '', clubId: '', menuId: '' });
    } catch { setTargetError('네트워크 오류'); }
    finally { setTargetLoading(false); }
  }, [targetForm]);

  const handleDeleteTarget = useCallback(async (id: string) => {
    if (!confirm('이 카페 타겟을 삭제하시겠습니까?')) return;
    try {
      await fetch('/api/cafe-targets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setTargets(prev => prev.filter(t => t.id !== id));
    } catch { setTargetError('삭제 실패'); }
  }, []);

  const handleToggleDefault = useCallback(async (id: string, isDefault: boolean) => {
    try {
      const res = await fetch('/api/cafe-targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isDefault }),
      });
      const json = await res.json();
      if (res.ok) setTargets(json.data);
    } catch { setTargetError('변경 실패'); }
  }, []);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)',
    borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit',
    outline: 'none',
  };

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
      {CHANNELS.map(ch => {
        const st = statuses[ch.id];
        const connected = st?.connected ?? false;
        const masked = st?.masked ?? {};
        const isLoading = loading[ch.id] ?? false;
        const error = errors[ch.id] ?? '';
        const ok = success[ch.id] ?? '';
        const formValues = forms[ch.id] ?? {};

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
                  <Badge connected={connected} />
                </div>
                {connected && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    {Object.entries(masked).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 10, color: 'var(--sub)', fontFamily: 'monospace', background: 'var(--n50)', padding: '1px 6px', borderRadius: 3 }}>
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {connected && (
                <button className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }} onClick={() => handleDisconnect(ch.id)} disabled={isLoading}>
                  연결 해제
                </button>
              )}
            </div>

            {/* 카페 타겟 관리 (네이버 카페 연결 시만) */}
            {ch.id === 'naver_cafe' && connected && (
              <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--border2)' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginTop: 14, marginBottom: 8 }}>카페 타겟 관리</p>
                <p style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 10 }}>같은 네이버 계정으로 가입된 여러 카페에 글을 발행할 수 있습니다.</p>

                {/* 등록된 타겟 목록 */}
                {targets.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {targets.map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--n50)', borderRadius: 6, padding: '8px 10px', fontSize: 12 }}>
                        <span style={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--sub)', fontFamily: 'monospace' }}>club:{t.clubId} / menu:{t.menuId}</span>
                        <button
                          onClick={() => handleToggleDefault(t.id, !t.isDefault)}
                          style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            background: t.isDefault ? '#E8F5E9' : 'var(--n100)',
                            color: t.isDefault ? '#2E7D32' : 'var(--sub)',
                          }}
                        >
                          {t.isDefault ? '기본' : '기본 설정'}
                        </button>
                        <button
                          onClick={() => handleDeleteTarget(t.id)}
                          style={{ fontSize: 10, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px' }}
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 카페 추가 폼 */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>카페 이름</label>
                    <input
                      type="text" placeholder="예: 부동산 정보 카페"
                      value={targetForm.name} onChange={e => setTargetForm(p => ({ ...p, name: e.target.value }))}
                      style={{ ...inputStyle, fontSize: 11 }} autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: '0 0 100px' }}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>카페 ID</label>
                    <input
                      type="text" placeholder="숫자"
                      value={targetForm.clubId} onChange={e => setTargetForm(p => ({ ...p, clubId: e.target.value }))}
                      style={{ ...inputStyle, fontSize: 11 }} autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: '0 0 100px' }}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>메뉴 ID</label>
                    <input
                      type="text" placeholder="숫자"
                      value={targetForm.menuId} onChange={e => setTargetForm(p => ({ ...p, menuId: e.target.value }))}
                      style={{ ...inputStyle, fontSize: 11 }} autoComplete="off"
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '7px 12px', flexShrink: 0 }}
                    onClick={handleAddTarget}
                    disabled={targetLoading}
                  >
                    {targetLoading ? '추가 중...' : '카페 추가'}
                  </button>
                </div>
                {targetError && (
                  <div style={{ fontSize: 11, color: '#dc2626', marginTop: 6 }}>{targetError}</div>
                )}
              </div>
            )}

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
                      onChange={e => setField(ch.id, f.key, e.target.value)}
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
                  onClick={() => handleConnect(ch.id)}
                  disabled={isLoading}
                >
                  {isLoading ? '검증 중...' : '연결 확인'}
                </button>
              </div>
            )}
          </div>
        );
      })}

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
