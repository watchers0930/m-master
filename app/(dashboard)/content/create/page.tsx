'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GenerateForm } from './components/GenerateForm';
import { ContentBody, ContentImages, parseMarkdown } from './components/ContentPreview';
import { createAbTest } from '@/lib/api/ab-test';
import type { ContentGenerateResponse } from '@/types/api';
import type { AbTestMeasureDays } from '@/types/db';

export default function ContentCreatePage() {
  return (
    <Suspense fallback={null}>
      <ContentCreatePageInner />
    </Suspense>
  );
}

function ContentCreatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTopic = searchParams.get('topic') ?? '';

  const [result, setResult] = useState<ContentGenerateResponse | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [deletedImgIdx, setDeletedImgIdx] = useState<Set<number>>(new Set());
  const [regeneratingIdx, setRegeneratingIdx] = useState<Set<number>>(new Set());
  const [thumbnailDeleted, setThumbnailDeleted] = useState(false);
  const [convertingChannel, setConvertingChannel] = useState<'instagram' | 'facebook' | undefined>(undefined);
  const [publishingChannel, setPublishingChannel] = useState<'instagram' | 'facebook' | undefined>(undefined);

  const [abMeasureDays, setAbMeasureDays] = useState<AbTestMeasureDays>(14);
  const [abStarting, setAbStarting] = useState(false);
  const [abError, setAbError] = useState<string | null>(null);

  const handleReset = () => {
    setResult(null);
    setStreamingText('');
    setIsStreaming(false);
    setDeletedImgIdx(new Set());
    setRegeneratingIdx(new Set());
    setThumbnailDeleted(false);
    setAbError(null);
  };

  const handleStartAbTest = async () => {
    if (!result) return;
    setAbStarting(true);
    setAbError(null);
    const res = await createAbTest({
      source_content_id: result.id,
      measure_days: abMeasureDays,
    });
    if (res.error) {
      setAbStarting(false);
      setAbError(res.error.message ?? 'A/B 테스트 시작에 실패했습니다');
      return;
    }
    router.push(`/ab-test/${res.data.id}`);
  };

  const handleRegenImg = async (imgIdx: number, description: string) => {
    if (!result) return;
    setRegeneratingIdx(prev => new Set([...prev, imgIdx]));
    try {
      const res = await fetch(`/api/content/${result.id}/body-image/regen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: imgIdx, description }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`재생성 실패: ${j?.error?.message ?? res.status}`);
        return;
      }
      const json = (await res.json()) as { data: { url: string; index: number } };
      // result.body_image_urls 갱신
      setResult(prev => {
        if (!prev) return prev;
        const next = [...(prev.body_image_urls ?? [])];
        while (next.length <= json.data.index) next.push('');
        next[json.data.index] = json.data.url;
        return { ...prev, body_image_urls: next };
      });
    } catch (err) {
      alert(`재생성 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegeneratingIdx(prev => {
        const next = new Set(prev);
        next.delete(imgIdx);
        return next;
      });
    }
  };

  const handleConvert = async (channel: 'instagram' | 'facebook', contentId: string) => {
    if (convertingChannel) return;
    setConvertingChannel(channel);
    try {
      const res = await fetch(`/api/content/${contentId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`${channel === 'instagram' ? '인스타' : '페이스북'} 변환 실패: ${j?.error?.message ?? res.status}`);
        return;
      }
      const newId = j?.data?.id;
      if (newId) {
        // 콘텐츠 관리 페이지로 이동 + 해당 채널 필터
        router.push(`/content/manage?id=${newId}`);
      } else {
        alert('변환은 성공했지만 ID를 받지 못했습니다');
      }
    } catch (err) {
      alert(`변환 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConvertingChannel(undefined);
    }
  };

  const handlePublish = async (channel: 'instagram' | 'facebook', contentId: string) => {
    if (publishingChannel) return;
    setPublishingChannel(channel);
    try {
      const res = await fetch(`/api/publish/${channel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_id: contentId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`${channel === 'instagram' ? '인스타' : '페이스북'} 발행 실패: ${j?.error?.message ?? res.status}`);
        return;
      }
      const url = j?.data?.url;
      if (url && window.confirm(`발행 완료. 게시물을 열어볼까요?\n${url}`)) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      alert(`발행 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishingChannel(undefined);
    }
  };

  const imageState = {
    deletedImgIdx,
    thumbnailDeleted,
    onDeleteImg: (i: number) => setDeletedImgIdx(prev => new Set([...prev, i])),
    onDeleteThumbnail: () => setThumbnailDeleted(true),
    regeneratingIdx,
    onRegenImg: handleRegenImg,
    convertingChannel,
    onConvert: handleConvert,
    publishingChannel,
    onPublish: handlePublish,
  };

  const emptyState = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', textAlign: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--n100)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-600)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
        </svg>
      </div>
      <p style={{ fontSize: 12, color: 'var(--sub)' }}>좌측에서 설정 후 생성 버튼을 누르세요</p>
    </div>
  );

  // 스트리밍 중 실시간 미리보기
  const streamingPreview = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {streamingText
        ? parseMarkdown(streamingText).map((block, i) => {
            if (block.type === 'h1') return <h1 key={i} style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>{block.text}</h1>;
            if (block.type === 'h2') return <h2 key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-700)', marginTop: 8, lineHeight: 1.4 }}>{block.text}</h2>;
            if (block.type === 'h3') return <h3 key={i} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{block.text}</h3>;
            if (block.type === 'li') return <div key={i} style={{ display: 'flex', gap: 6 }}><span style={{ color: 'var(--blue-400)', fontSize: 10, marginTop: 3 }}>●</span><p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7 }}>{block.text}</p></div>;
            if (block.type === 'blockquote') return <div key={i} style={{ borderLeft: '3px solid var(--blue-300)', paddingLeft: 10 }}><p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7, fontStyle: 'italic' }}>{block.text}</p></div>;
            if (block.type === 'img-placeholder') return <div key={i} style={{ border: '1.5px dashed var(--border)', borderRadius: 6, padding: '8px 12px', background: 'var(--n50)', display: 'flex', alignItems: 'center', gap: 8 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--n400)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg><span style={{ fontSize: 10.5, color: 'var(--sub)', fontStyle: 'italic' }}>{block.text}</span></div>;
            if (block.type === 'table') return (
              <div key={i} style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                  <thead><tr>{block.headers.map((h, hi) => <th key={hi} style={{ border: '1px solid var(--border)', background: 'var(--n50)', padding: '5px 9px', textAlign: 'left', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                  <tbody>{block.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ border: '1px solid var(--border)', padding: '5px 9px', color: 'var(--sub)' }}>{cell}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
            if (block.type === 'p') return <p key={i} style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7 }}>{block.text}</p>;
            return null;
          })
        : <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue-500)', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 12, color: 'var(--sub)' }}>GPT-4o가 작성 중입니다...</span>
          </div>
      }
      {/* 커서 */}
      <span style={{ display: 'inline-block', width: 2, height: 14, background: 'var(--blue-500)', animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1650, paddingBottom: 60 }}>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr) 400px', gap: 14, alignItems: 'start' }}>

        {/* 1열: 생성 설정 */}
        <div className="card" style={{ position: 'sticky', top: 0, height: 'calc(100vh - var(--topbar-h) - 18px - 76px)', display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <span className="card-title">생성 설정</span>
            <span style={{ fontSize: 10, color: 'var(--sub)' }}>GPT-4o + RAG</span>
          </div>
          <div style={{ padding: '16px', flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <GenerateForm
              initialTopic={initialTopic}
              onResult={(r) => { setResult(r); setIsStreaming(false); }}
              onStreamStart={() => { setStreamingText(''); setIsStreaming(true); setResult(null); }}
              onStreamDelta={(delta) => setStreamingText(prev => prev + delta)}
            />
          </div>
        </div>

        {/* 2열: 본문 미리보기 */}
        <div className="card" style={{ height: 'calc(100vh - var(--topbar-h) - 18px - 76px)', display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
            </svg>
            <span className="card-title">본문 미리보기</span>
            {isStreaming && <span style={{ fontSize: 10, color: 'var(--blue-500)', marginLeft: 4 }}>{streamingText.length.toLocaleString()}자 생성 중...</span>}
            {!isStreaming && result && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  value={abMeasureDays}
                  onChange={(e) => setAbMeasureDays(Number(e.target.value) as AbTestMeasureDays)}
                  disabled={abStarting}
                  aria-label="A/B 측정 기간"
                  style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
                >
                  <option value={7}>7일</option>
                  <option value={14}>14일</option>
                  <option value={30}>30일</option>
                </select>
                <button
                  type="button"
                  onClick={handleStartAbTest}
                  disabled={abStarting}
                  aria-label="이 콘텐츠로 A/B 테스트 시작"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 4,
                    border: '1px solid var(--blue-300)',
                    background: abStarting ? 'var(--n100)' : 'var(--blue-50)',
                    color: abStarting ? 'var(--sub)' : 'var(--blue-700)',
                    fontSize: 11, fontWeight: 600,
                    cursor: abStarting ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {abStarting ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 11-6.219-8.56"/>
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M9 3h6M9 3v8L5 21h14L15 11V3"/>
                    </svg>
                  )}
                  A/B 테스트 시작
                </button>
              </div>
            )}
          </div>
          {abError && (
            <div style={{ padding: '6px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#dc2626', fontSize: 11 }}>
              {abError}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, padding: '16px', paddingBottom: 20, display: 'flex', flexDirection: 'column' }}>
            {isStreaming && streamingPreview}
            {!isStreaming && !result && emptyState}
            {!isStreaming && result && <ContentBody result={result} imageState={imageState} onReset={handleReset} />}
          </div>
        </div>

        {/* 3열: 이미지 */}
        <div className="card" style={{ height: 'calc(100vh - var(--topbar-h) - 18px - 76px)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0 }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
            </svg>
            <span className="card-title">이미지</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px', paddingBottom: 20 }}>
            {result
              ? <ContentImages result={result} imageState={imageState} />
              : <p style={{ fontSize: 11, color: 'var(--sub)', textAlign: 'center', padding: '40px 0' }}>생성 후 이미지가 표시됩니다</p>
            }
          </div>
        </div>

      </div>

      <div style={{ height: 20 }} />

      <div style={{ position: 'fixed', bottom: 20, left: 'calc(var(--sidebar-w, 216px) + 22px)', right: 22, zIndex: 10, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: 'var(--blue-700)', display: 'flex', gap: 8, alignItems: 'flex-start', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>생성된 HTML은 og 메타, schema.org 마크업이 포함됩니다. RAG 문서를 미리 등록하면 더 정확한 콘텐츠가 생성됩니다.</span>
      </div>

    </div>
  );
}
