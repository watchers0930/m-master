'use client';

import { useState } from 'react';
import type { ContentGenerateResponse } from '@/types/api';
import type { ImageState } from './PublishButtons';
import { parseMarkdown } from './markdown-parser';

// ── 이미지 액션 버튼 ─────────────────────────────────────────────
function ImgActionBtns({
  onUpload,
  onRegen,
  onEdit,
  onDelete,
  regenDisabled,
}: {
  onUpload: (file: File) => void;
  onRegen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  regenDisabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--sub)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        업로드
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { onUpload(file); e.target.value = ''; }
          }}
        />
      </label>
      <button onClick={onRegen} disabled={regenDisabled} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: regenDisabled ? 'var(--sub)' : 'var(--blue-600)', background: regenDisabled ? 'var(--n100)' : 'var(--blue-50)', border: `1px solid ${regenDisabled ? 'var(--border)' : 'var(--blue-200)'}`, borderRadius: 4, padding: '3px 8px', cursor: regenDisabled ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: regenDisabled ? 'spin 1s linear infinite' : undefined }}><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
        재생성
      </button>
      <button onClick={onEdit} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--sub)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        편집
      </button>
      <button onClick={onDelete} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        삭제
      </button>
    </div>
  );
}

// ── 3열: 이미지 관리 패널 ─────────────────────────────────────────
interface ContentImagesProps {
  result: ContentGenerateResponse;
  imageState: ImageState;
}

export function ContentImages({ result, imageState }: ContentImagesProps) {
  const [thumbErr, setThumbErr] = useState(false);
  const blocks = parseMarkdown(result.text);
  const imgBlocks = blocks.filter((b): b is { type: 'img-placeholder'; text: string } => b.type === 'img-placeholder');
  const titleBlock = blocks.find((b): b is { type: 'h1'; text: string } => b.type === 'h1');
  const title = titleBlock?.text ?? '';

  const visibleCount = imgBlocks.length - imageState.deletedImgIdx.size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 썸네일 */}
      {!imageState.thumbnailDeleted && (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>썸네일</span>
            {result.image_url && !thumbErr
              ? <span style={{ fontSize: 9, color: 'var(--sub)', background: 'var(--n100)', borderRadius: 3, padding: '1px 6px' }}>DALL-E 3</span>
              : <span style={{ fontSize: 9, color: 'var(--amber-600)', background: 'var(--amber-50)', border: '1px solid var(--amber-200)', borderRadius: 3, padding: '1px 6px' }}>이미지 미생성</span>
            }
          </div>
          {result.image_url && !thumbErr ? (
            <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--n50)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.image_url} alt={title || '생성된 썸네일'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setThumbErr(true)} />
            </div>
          ) : (
            <div style={{ aspectRatio: '16/9', background: 'var(--n50)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1.5px dashed var(--border)', margin: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
              </svg>
              <span style={{ fontSize: 10, color: 'var(--sub)' }}>대표 썸네일 이미지</span>
            </div>
          )}
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--n50)' }}>
            <ImgActionBtns
              onUpload={(file) => alert(`썸네일 업로드: ${file.name} — BE 연동 후 구현`)}
              onRegen={() => alert('썸네일 재생성 — BE 연동 후 구현')}
              onEdit={() => alert('썸네일 편집 — 추후 구현')}
              onDelete={imageState.onDeleteThumbnail}
            />
          </div>
        </div>
      )}

      {/* 본문 이미지 — 2열 그리드 */}
      {imgBlocks.length > 0 && (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>본문 이미지</span>
            <span style={{ fontSize: 10, color: 'var(--sub)' }}>{visibleCount}개</span>
          </div>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              let imgCounter = 0;
              return blocks.map((block, i) => {
                if (block.type !== 'img-placeholder') return null;
                const myImgIdx = imgCounter++;
                const deleted = imageState.deletedImgIdx.has(i);
                const url = result.body_image_urls?.[myImgIdx];
                const isRegenerating = imageState.regeneratingIdx?.has(myImgIdx);
                return (
                  <div key={i} style={{ borderRadius: 6, border: url ? '1px solid var(--border)' : '1.5px dashed var(--border)', overflow: 'hidden', opacity: deleted ? 0.35 : 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--n50)' }}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={block.text} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 16px' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
                          </svg>
                          <span style={{ fontSize: 10, color: 'var(--sub)', textAlign: 'center', lineHeight: 1.5 }}>{block.text}</span>
                        </div>
                      )}
                      {isRegenerating && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-500)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                            <path d="M21 12a9 9 0 11-6.219-8.56"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '4px 8px', background: 'var(--n50)', borderTop: '1px solid var(--border)' }}>
                      <p style={{ fontSize: 9.5, color: 'var(--sub)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }} title={block.text}>{block.text}</p>
                    </div>
                    {!deleted && (
                      <div style={{ padding: '6px 8px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                        <ImgActionBtns
                          onUpload={(file) => alert(`이미지 업로드: ${file.name} — 추후 Storage 연동 필요`)}
                          onRegen={() => imageState.onRegenImg?.(myImgIdx, block.text)}
                          onEdit={() => alert(`"${block.text}" 편집 — 추후 구현`)}
                          onDelete={() => imageState.onDeleteImg(i)}
                          regenDisabled={isRegenerating}
                        />
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
