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

  const CHANNEL_ROUTES: Record<PublishAllChannel, string> = {
    naver_cafe: '/api/publish/naver-cafe',
    facebook: '/api/publish/facebook',
    instagram: '/api/publish/instagram',
  };

  const handlePublishAll = async () => {
    if (!window.confirm('모든 활성 채널(네이버 카페, 페이스북, 인스타그램)에 순차 발행합니다.\n\n발행은 취소할 수 없습니다. 계속하시겠습니까?')) {
      return;
    }

    setPublishing(true);
    setResult(null);

    const channels: PublishAllChannel[] = ['naver_cafe', 'facebook', 'instagram'];
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const channel of channels) {
      try {
        const res = await fetch(CHANNEL_ROUTES[channel], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_id: contentId }),
        });
        const json = await res.json();
        if (res.ok && !json.error) {
          success++;
        } else {
          failed++;
          errors.push(`${channel}: ${json.error?.message ?? `HTTP ${res.status}`}`);
        }
      } catch (err) {
        failed++;
        errors.push(`${channel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const msg = `${channels.length}채널 발행 완료 (성공 ${success} / 실패 ${failed})`;
    setResult(msg);
    setPublishing(false);

    if (errors.length > 0) {
      console.error('[PublishAll] 실패 상세:', errors);
    }
  };

  return (
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
      {result && (
        <span style={{ fontSize: 10, color: result.includes('실패 0') ? '#22c55e' : 'var(--amber-600)', fontWeight: 600 }}>
          {result}
        </span>
      )}
    </div>
  );
}
