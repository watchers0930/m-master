'use client';

import { useState } from 'react';

// ── 공유 타입 ─────────────────────────────────────────────────────
export interface ImageState {
  deletedImgIdx: Set<number>;
  thumbnailDeleted: boolean;
  onDeleteImg: (i: number) => void;
  onDeleteThumbnail: () => void;
  regeneratingIdx?: Set<number>;
  onRegenImg?: (imgIdx: number, description: string) => void;
  convertingChannel?: 'instagram' | 'facebook';
  onConvert?: (channel: 'instagram' | 'facebook', contentId: string) => void;
  publishingChannel?: 'instagram' | 'facebook';
  onPublish?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}

// ── 변환 버튼 (인스타/페이스북) ───────────────────────────────────
export function ConvertBtn({
  channel,
  contentId,
  disabled,
  loading,
  onClick,
}: {
  channel: 'instagram' | 'facebook';
  contentId: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}) {
  const label = channel === 'instagram' ? '인스타 변환' : '페이스북 변환';
  const bg = channel === 'instagram'
    ? 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'
    : '#1877f2';
  return (
    <button
      onClick={() => onClick?.(channel, contentId)}
      disabled={disabled || !onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 13px', borderRadius: 7,
        fontSize: 12, fontWeight: 600,
        border: 'none', cursor: disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        background: disabled ? 'var(--n200)' : bg,
        color: '#fff',
        opacity: disabled && !loading ? 0.6 : 1,
      }}
    >
      {loading ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      ) : channel === 'instagram' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
        </svg>
      )}
      {loading ? '변환 중...' : label}
    </button>
  );
}

// ── 즉시 발행 버튼 (Graph API) ───────────────────────────────────
export function PublishBtn({
  channel,
  contentId,
  disabled,
  loading,
  onClick,
}: {
  channel: 'instagram' | 'facebook';
  contentId: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}) {
  const label = channel === 'instagram' ? '인스타 발행' : '페북 발행';
  const baseBg = channel === 'instagram'
    ? 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'
    : '#1877f2';
  const confirmMsg = `${channel === 'instagram' ? '인스타그램' : '페이스북'}에 즉시 발행하시겠습니까?\n\n발행은 취소할 수 없습니다.`;
  return (
    <button
      onClick={() => {
        if (!onClick) return;
        if (window.confirm(confirmMsg)) onClick(channel, contentId);
      }}
      disabled={disabled || !onClick}
      title="Graph API로 즉시 발행 — 토큰이 설정돼 있어야 합니다"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 13px', borderRadius: 7,
        fontSize: 12, fontWeight: 700,
        border: '2px solid #fff',
        boxShadow: '0 0 0 1.5px rgba(0,0,0,0.15)',
        cursor: disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        background: disabled ? 'var(--n200)' : baseBg,
        color: '#fff',
        opacity: disabled && !loading ? 0.6 : 1,
      }}
    >
      {loading ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22,2 15,22 11,13 2,9 22,2"/>
        </svg>
      )}
      {loading ? '발행 중...' : label}
    </button>
  );
}

// ── 카페 타겟 타입 ────────────────────────────────────────────────
interface CafeTarget { id: string; name: string; isDefault: boolean }

// ── 모든 채널 일괄 발행 버튼 ─────────────────────────────────────
type PublishAllChannel = 'naver_cafe' | 'facebook' | 'instagram';

export function PublishAllBtn({
  contentId,
  disabled,
  onPublish,
}: {
  contentId: string;
  disabled?: boolean;
  onPublish?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [cafeTargets, setCafeTargets] = useState<CafeTarget[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [showCafeSelect, setShowCafeSelect] = useState(false);

  const CHANNEL_ROUTES: Record<PublishAllChannel, string> = {
    naver_cafe: '/api/publish/naver-cafe',
    facebook: '/api/publish/facebook',
    instagram: '/api/publish/instagram',
  };

  // 카페 타겟 목록 로드
  const loadCafeTargets = async () => {
    try {
      const res = await fetch('/api/cafe-targets');
      const json = await res.json();
      if (res.ok && json.data) {
        const tgts: CafeTarget[] = json.data;
        setCafeTargets(tgts);
        setSelectedTargets(new Set(tgts.map((t: CafeTarget) => t.id)));
      }
    } catch { /* 실패 시 빈 목록 */ }
  };

  const handlePublishAll = async () => {
    // 카페 타겟이 로드되지 않았으면 먼저 로드
    if (cafeTargets.length === 0) {
      await loadCafeTargets();
    }

    if (!window.confirm('모든 활성 채널에 순차 발행합니다.\n\n발행은 취소할 수 없습니다. 계속하시겠습니까?')) {
      return;
    }

    setPublishing(true);
    setResult(null);

    const channels: PublishAllChannel[] = ['naver_cafe', 'facebook', 'instagram'];
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const channel of channels) {
      try {
        const bodyPayload: Record<string, unknown> = { content_id: contentId };
        // 네이버 카페: 선택된 타겟 전달
        if (channel === 'naver_cafe' && selectedTargets.size > 0) {
          bodyPayload.cafe_target_ids = Array.from(selectedTargets);
        }

        const res = await fetch(CHANNEL_ROUTES[channel], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload),
        });
        const json = await res.json();
        if (res.ok && !json.error) {
          successCount++;
        } else {
          failedCount++;
          errors.push(`${channel}: ${json.error?.message ?? `HTTP ${res.status}`}`);
        }
      } catch (err) {
        failedCount++;
        errors.push(`${channel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const msg = `${channels.length}채널 발행 완료 (성공 ${successCount} / 실패 ${failedCount})`;
    setResult(msg);
    setPublishing(false);

    if (errors.length > 0) {
      console.error('[PublishAll] 실패 상세:', errors);
    }
  };

  // 카페 선택 토글 열기 시 타겟 로드
  const handleShowCafeSelect = async () => {
    if (!showCafeSelect && cafeTargets.length === 0) {
      await loadCafeTargets();
    }
    setShowCafeSelect(!showCafeSelect);
  };

  const toggleTarget = (id: string) => {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={handlePublishAll}
          disabled={disabled || publishing}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 13px', borderRadius: 7,
            fontSize: 12, fontWeight: 700,
            border: '2px solid #fff',
            boxShadow: '0 0 0 1.5px rgba(0,0,0,0.15)',
            cursor: disabled || publishing ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            background: disabled || publishing ? 'var(--n200)' : 'linear-gradient(135deg, #03C75A 0%, #1877f2 50%, #e1306c 100%)',
            color: '#fff',
            opacity: disabled && !publishing ? 0.6 : 1,
          }}
        >
          {publishing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22,2 15,22 11,13 2,9 22,2"/>
            </svg>
          )}
          {publishing ? '일괄 발행 중...' : '전체 채널 발행'}
        </button>
        <button
          onClick={handleShowCafeSelect}
          disabled={disabled || publishing}
          title="발행 대상 카페 선택"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
          카페 선택
        </button>
        {result && (
          <span style={{ fontSize: 10, color: result.includes('실패 0') ? '#22c55e' : 'var(--amber-600)', fontWeight: 600 }}>
            {result}
          </span>
        )}
      </div>

      {/* 카페 타겟 선택 패널 */}
      {showCafeSelect && cafeTargets.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
          <p style={{ fontSize: 10, color: 'var(--sub)', marginBottom: 6 }}>발행 대상 카페를 선택하세요:</p>
          {cafeTargets.map(t => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedTargets.has(t.id)}
                onChange={() => toggleTarget(t.id)}
                style={{ accentColor: '#03C75A' }}
              />
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>
              {t.isDefault && <span style={{ fontSize: 9, color: '#2E7D32', background: '#E8F5E9', padding: '1px 4px', borderRadius: 3 }}>기본</span>}
            </label>
          ))}
        </div>
      )}
      {showCafeSelect && cafeTargets.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--sub)', padding: '4px 0' }}>
          등록된 카페 타겟이 없습니다. 채널 설정에서 카페를 추가하세요.
        </div>
      )}
    </div>
  );
}
