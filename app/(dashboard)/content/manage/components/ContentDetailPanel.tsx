'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { getContent } from '@/lib/api/content';
import { createAbTest } from '@/lib/api/ab-test';
import type { Content, AbTestMeasureDays } from '@/types/db';
import { parseMarkdown, renderInline, ConvertBtn } from '@/app/(dashboard)/content/create/components/ContentPreview';

const STATUS_LABEL: Record<string, string> = {
  draft: '초안', scheduled: '예약됨', published: '발행됨', failed: '실패',
};
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  draft:     { bg: 'var(--n100)',      color: 'var(--sub)' },
  scheduled: { bg: 'var(--blue-100)',  color: 'var(--blue-600)' },
  published: { bg: 'var(--green-100)', color: 'var(--green-700)' },
  failed:    { bg: '#fee2e2',          color: '#dc2626' },
};
const CHANNEL_LABEL: Record<string, string> = {
  blog: '블로그', naver_cafe: '네이버 카페', instagram: '인스타그램', facebook: '페이스북',
};

interface Props {
  contentId: string | null;
}

// 본문을 parseMarkdown 기반으로 렌더 — h1/h2/h3/li/blockquote/table/img-placeholder/p 모두 처리
function renderBodyWithImages(text: string, bodyImageUrls: string[]) {
  const blocks = parseMarkdown(text);
  let imgIdx = 0;
  return blocks.map((block, i) => {
    if (block.type === 'img-placeholder') {
      const myIdx = imgIdx++;
      const url = bodyImageUrls[myIdx];
      if (url) {
        return (
          <figure key={i} style={{ margin: '12px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={block.text}
              style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}
            />
            <figcaption style={{ fontSize: 10.5, color: 'var(--sub)', textAlign: 'center', marginTop: 4, fontStyle: 'italic' }}>
              {block.text}
            </figcaption>
          </figure>
        );
      }
      return (
        <div key={i} style={{ border: '1.5px dashed var(--border)', borderRadius: 6, padding: '14px 12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--n400, #94a3b8)" strokeWidth="1.6" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
          </svg>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600, margin: 0 }}>이미지</p>
            <p style={{ fontSize: 11.5, color: 'var(--text)', fontStyle: 'italic', margin: '2px 0 0', lineHeight: 1.4 }}>{block.text}</p>
          </div>
        </div>
      );
    }
    if (block.type === 'h1') return <h1 key={i} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, margin: '10px 0 6px' }}>{renderInline(block.text)}</h1>;
    if (block.type === 'h2') return <h2 key={i} style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue-700)', marginTop: 10, marginBottom: 4, lineHeight: 1.4 }}>{renderInline(block.text)}</h2>;
    if (block.type === 'h3') return <h3 key={i} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginTop: 6, marginBottom: 2, lineHeight: 1.4 }}>{renderInline(block.text)}</h3>;
    if (block.type === 'li') return (
      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '2px 0' }}>
        <span style={{ color: 'var(--blue-400)', marginTop: 3, flexShrink: 0, fontSize: 10 }}>●</span>
        <p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7, margin: 0 }}>{renderInline(block.text)}</p>
      </div>
    );
    if (block.type === 'blockquote') return (
      <div key={i} style={{ borderLeft: '3px solid var(--blue-300)', paddingLeft: 10, margin: '6px 0' }}>
        <p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7, fontStyle: 'italic', margin: 0 }}>{renderInline(block.text)}</p>
      </div>
    );
    if (block.type === 'table') return (
      <div key={i} style={{ overflowX: 'auto', margin: '10px 0' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
          <thead>
            <tr>
              {block.headers.map((h, hi) => (
                <th key={hi} style={{ border: '1px solid var(--border)', background: 'var(--n50)', padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>{renderInline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: '1px solid var(--border)', padding: '6px 10px', color: 'var(--sub)', lineHeight: 1.5 }}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    if (block.type === 'p') return <p key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, margin: '4px 0' }}>{renderInline(block.text)}</p>;
    return null;
  });
}

export default function ContentDetailPanel({ contentId }: Props) {
  const router = useRouter();
  const [abMeasureDays, setAbMeasureDays] = useState<AbTestMeasureDays>(14);
  const [abStarting, setAbStarting] = useState(false);
  const [abError, setAbError] = useState<string | null>(null);
  const [convertingChannel, setConvertingChannel] = useState<'instagram' | 'facebook' | undefined>(undefined);
  const [publishingChannel, setPublishingChannel] = useState<string | undefined>(undefined);

  const { data: content, isFetching, error: queryError } = useQuery<Content | null>({
    queryKey: ['content', 'detail', contentId],
    enabled: !!contentId,
    queryFn: async () => {
      if (!contentId) return null;
      const res = await getContent(contentId);
      if (res.error) throw new Error(res.error.message ?? '콘텐츠를 불러오지 못했습니다');
      return res.data as Content;
    },
  });
  const data: Content | null = contentId ? content ?? null : null;
  const loading = !!contentId && isFetching;
  const errorMsg = contentId && queryError ? queryError.message : null;

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
      if (newId) router.push(`/content/manage?id=${newId}`);
      else alert('변환은 성공했지만 ID를 받지 못했습니다');
    } catch (err) {
      alert(`변환 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConvertingChannel(undefined);
    }
  };

  const handlePublish = async (channel: string, contentId: string) => {
    if (publishingChannel) return;
    const chLabel = CHANNEL_LABEL[channel] ?? channel;
    // naver_cafe → API 경로는 naver-cafe
    const apiChannel = channel.replace('_', '-');
    setPublishingChannel(channel);
    try {
      const res = await fetch(`/api/publish/${apiChannel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_id: contentId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`${chLabel} 발행 실패: ${j?.error?.message ?? res.status}`);
        return;
      }
      const url = j?.data?.url ?? j?.data?.download_url;
      if (url && window.confirm(`${chLabel} 발행 완료!\n${url}\n\n게시물을 열어볼까요?`)) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert(`${chLabel} 발행 완료`);
      }
    } catch (err) {
      alert(`발행 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishingChannel(undefined);
    }
  };

  const handleStartAbTest = async () => {
    if (!data) return;
    setAbStarting(true);
    setAbError(null);
    const res = await createAbTest({ source_content_id: data.id, measure_days: abMeasureDays });
    if (res.error) {
      setAbStarting(false);
      setAbError(res.error.message ?? 'A/B 테스트 시작에 실패했습니다');
      return;
    }
    router.push(`/ab-test/${res.data.id}`);
  };

  const status = data?.status;
  const stStyle = status ? STATUS_STYLE[status] ?? STATUS_STYLE.draft : null;
  const avg = data?.scores?.avg;
  const scoreColor = avg !== undefined ? (avg >= 80 ? 'var(--green-700)' : avg >= 60 ? 'var(--amber-700)' : '#dc2626') : undefined;
  const scoreBg    = avg !== undefined ? (avg >= 80 ? 'var(--green-100)' : avg >= 60 ? 'var(--amber-100)' : '#fee2e2') : undefined;

  return (
    <div
      className="card"
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100%', minHeight: 0,
      }}
    >
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>미리보기</h2>
      </div>

      {/* 본문 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!contentId ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--sub)', gap: 8 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="14 2 14 8 20 8"/>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            </svg>
            <p style={{ fontSize: 12, margin: 0 }}>왼쪽 목록에서 콘텐츠를 선택하세요</p>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
          </div>
        ) : errorMsg ? (
          <p style={{ color: '#dc2626', fontSize: 12.5, padding: '24px 0', textAlign: 'center' }}>{errorMsg}</p>
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 토픽 + 메타 */}
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0, lineHeight: 1.4 }}>{data.topic}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>{CHANNEL_LABEL[data.channel] ?? data.channel}</span>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>톤: {data.tone ?? '—'}</span>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>{new Date(data.created_at).toLocaleString('ko-KR')}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {stStyle && (
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: stStyle.bg, color: stStyle.color }}>
                    {STATUS_LABEL[data.status] ?? data.status}
                  </span>
                )}
                {avg !== undefined && (
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: scoreBg, color: scoreColor }}>
                    AI {avg}점
                  </span>
                )}
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: 'var(--n100)', color: 'var(--sub)' }}>
                  비용 {data.cost_krw.toLocaleString()}원
                </span>
              </div>
            </div>

            {/* 점수 상세 */}
            {data.scores && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 12, background: 'var(--n50)', borderRadius: 8 }}>
                {[
                  { key: 'seo', label: 'SEO' },
                  { key: 'readability', label: '가독성' },
                  { key: 'brand', label: '브랜드' },
                  { key: 'legal', label: '법률' },
                ].map((s) => (
                  <div key={s.key} style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 10.5, color: 'var(--sub)', margin: 0 }}>{s.label}</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '2px 0 0' }}>{data.scores![s.key as keyof typeof data.scores] ?? '—'}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 키워드 */}
            {data.keywords && data.keywords.length > 0 && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>키워드</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {data.keywords.map((k) => (
                    <span key={k} style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontSize: 11, background: 'var(--blue-100)', color: 'var(--blue-600)' }}>
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 이미지 */}
            {data.image_url && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>이미지</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.image_url} alt={data.topic} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              </div>
            )}

            {/* 본문 */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>본문</p>
              <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--n50)', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7, wordBreak: 'break-word' }}>
                {data.text_body
                  ? renderBodyWithImages(data.text_body, data.body_image_urls ?? [])
                  : <span style={{ color: 'var(--sub)' }}>본문이 없습니다</span>}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 푸터 */}
      {data && (
        <>
          {abError && (
            <div style={{ padding: '6px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#dc2626', fontSize: 11 }}>
              {abError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--n50)', flexWrap: 'wrap' }}>
            {data.channel === 'blog' && (
              <>
                <select
                  value={abMeasureDays}
                  onChange={(e) => setAbMeasureDays(Number(e.target.value) as AbTestMeasureDays)}
                  disabled={abStarting}
                  aria-label="A/B 측정 기간"
                  style={{ fontSize: 11.5, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', marginRight: 'auto' }}
                >
                  <option value={7}>측정 7일</option>
                  <option value={14}>측정 14일</option>
                  <option value={30}>측정 30일</option>
                </select>
                <button
                  type="button"
                  onClick={handleStartAbTest}
                  disabled={abStarting}
                  aria-label="이 콘텐츠로 A/B 테스트 시작"
                  style={{
                    padding: '8px 14px', borderRadius: 6,
                    border: '1px solid var(--amber-400, #fbbf24)',
                    background: abStarting ? 'var(--n100)' : 'var(--amber-100)',
                    color: abStarting ? 'var(--sub)' : 'var(--amber-700)',
                    fontSize: 12, fontWeight: 600,
                    cursor: abStarting ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {abStarting ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 11-6.219-8.56"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M9 3h6M9 3v8L5 21h14L15 11V3"/>
                    </svg>
                  )}
                  A/B 테스트 시작
                </button>
                <ConvertBtn channel="instagram" contentId={data.id} disabled={convertingChannel !== undefined} loading={convertingChannel === 'instagram'} onClick={handleConvert} />
                <ConvertBtn channel="facebook"  contentId={data.id} disabled={convertingChannel !== undefined} loading={convertingChannel === 'facebook'}  onClick={handleConvert} />
              </>
            )}
            {data.channel === 'blog' && (
              <a
                href={`/api/content/${data.id}/download`}
                title="HTML 파일로 다운로드"
                style={{
                  padding: '8px 14px', borderRadius: 6,
                  border: '1px solid var(--blue-400)',
                  background: 'var(--blue-400)',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                HTML 다운로드
              </a>
            )}
            {/* 발행/재발행 버튼 — 모든 채널 공통 */}
            {(data.channel === 'naver_cafe' || data.channel === 'instagram' || data.channel === 'facebook') && (
              <button
                type="button"
                onClick={() => handlePublish(data.channel, data.id)}
                disabled={!!publishingChannel}
                style={{
                  padding: '8px 14px', borderRadius: 6,
                  border: '1px solid var(--green-600, #16a34a)',
                  background: publishingChannel === data.channel ? 'var(--n100)' : 'var(--green-600, #16a34a)',
                  color: publishingChannel === data.channel ? 'var(--sub)' : '#fff',
                  fontSize: 12, fontWeight: 600,
                  cursor: publishingChannel ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {publishingChannel === data.channel ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  </svg>
                )}
                {data.status === 'published' ? '재발행' : '발행'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
