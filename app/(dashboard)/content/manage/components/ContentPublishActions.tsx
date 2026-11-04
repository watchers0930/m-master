// 상세 패널 푸터 — 기존 A/B·변환·다운로드·발행 버튼 (설계 §6, 기존 ContentDetailPanel 에서 이전).
// publish.allowed=false 면 발행 버튼을 비활성화하고 서버 사유를 표시한다. 비활성화는 UX일 뿐,
// 실제 차단은 발행 API(isPublishable)가 한다(설계 §4.1).
'use client';

import { useState } from 'react';
import type { AbTestMeasureDays } from '@/types/db';
import { usePublishContent } from '@/hooks/usePublishContent';
import { ConvertBtn } from '@/app/(dashboard)/content/create/components/ContentPreview';
import type { ContentDetail, PublishBlockReason, PublishChannel } from '@/types/content-review';

const BLOCK_TEXT: Record<PublishBlockReason, string> = {
  not_approved: '승인 후 발행할 수 있습니다',
  rejected: '반려된 콘텐츠입니다',
  parent_not_approved: '원본 콘텐츠 승인이 필요합니다',
  already_published: '이미 발행되었습니다',
  claim_held: '발행이 진행 중입니다',
  version_mismatch: '내용이 바뀌었습니다. 새로고침 후 다시 시도하세요',
  owner_mismatch: '발행할 수 없는 콘텐츠입니다',
  channel_mismatch: '발행할 수 없는 채널입니다',
  not_due: '아직 발행 시각이 아닙니다',
  job_not_pending: '발행 대기 상태가 아닙니다',
};

const PUBLISHABLE: readonly PublishChannel[] = ['naver_cafe', 'instagram', 'facebook'];

const Spinner = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
    <path d="M21 12a9 9 0 11-6.219-8.56"/>
  </svg>
);

export default function ContentPublishActions({ content }: { content: ContentDetail }) {
  const { publish, publishing, convert, converting, startAbTest, abStarting, abError } = usePublishContent(content.id);
  const [abMeasureDays, setAbMeasureDays] = useState<AbTestMeasureDays>(14);

  const pub = content.publish;
  const publishChannel = (PUBLISHABLE as readonly string[]).includes(content.channel) ? (content.channel as PublishChannel) : null;
  const blocked = pub ? !pub.allowed : false;
  const blockText = blocked ? (pub.reason ? BLOCK_TEXT[pub.reason] : null) ?? '지금은 발행할 수 없습니다' : null;
  const publishDisabled = !!publishing || blocked;

  return (
    <>
      {abError && (
        <div style={{ padding: '6px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#dc2626', fontSize: 11 }}>{abError}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--n50)', flexWrap: 'wrap' }}>
        {content.channel === 'blog' && (
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
              onClick={() => startAbTest(abMeasureDays)}
              disabled={abStarting}
              aria-label="이 콘텐츠로 A/B 테스트 시작"
              style={{
                padding: '8px 14px', borderRadius: 6, border: '1px solid var(--amber-400, #fbbf24)',
                background: abStarting ? 'var(--n100)' : 'var(--amber-100)', color: abStarting ? 'var(--sub)' : 'var(--amber-700)',
                fontSize: 12, fontWeight: 600, cursor: abStarting ? 'wait' : 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {abStarting ? <Spinner /> : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M9 3h6M9 3v8L5 21h14L15 11V3"/>
                </svg>
              )}
              A/B 테스트 시작
            </button>
            <ConvertBtn channel="instagram" contentId={content.id} disabled={converting !== undefined} loading={converting === 'instagram'} onClick={convert} />
            <ConvertBtn channel="facebook"  contentId={content.id} disabled={converting !== undefined} loading={converting === 'facebook'}  onClick={convert} />
            <a
              href={`/api/content/${content.id}/download`}
              title="HTML 파일로 다운로드"
              style={{
                padding: '8px 14px', borderRadius: 6, border: '1px solid var(--blue-400)', background: 'var(--blue-400)',
                color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              HTML 다운로드
            </a>
          </>
        )}

        {publishChannel && (
          <>
            {blockText && <span style={{ fontSize: 11, color: 'var(--sub)' }}>{blockText}</span>}
            <button
              type="button"
              onClick={() => publish(publishChannel)}
              disabled={publishDisabled}
              title={blockText ?? undefined}
              style={{
                padding: '8px 14px', borderRadius: 6,
                border: `1px solid ${blocked ? 'var(--border)' : 'var(--green-600, #16a34a)'}`,
                background: publishDisabled ? 'var(--n100)' : 'var(--green-600, #16a34a)',
                color: publishDisabled ? 'var(--sub)' : '#fff', fontSize: 12, fontWeight: 600,
                cursor: publishing ? 'wait' : blocked ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {publishing === publishChannel ? <Spinner /> : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                </svg>
              )}
              발행
            </button>
          </>
        )}
      </div>
    </>
  );
}
