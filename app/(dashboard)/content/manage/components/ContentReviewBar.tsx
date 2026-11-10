// 검토 바 — 승인·반려·재검토 버튼 + 반려 사유 (설계 §4.3·§6).
// 노출 버튼은 UX 안내일 뿐 — 전이 가능 여부·CAS·claim 충돌은 서버가 최종 판정(409 시 재조회).
'use client';

import { useState } from 'react';
import { useContentReview, type ReviewNotice } from '@/hooks/useContentReview';
import type { ContentDetail, ReviewDecision } from '@/types/content-review';
import { REVIEW_LABEL } from './ReviewBadge';

const REASON_MAX = 500;

const btn = (bg: string, color: string, border: string, busy: boolean): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 6, border: `1px solid ${border}`, background: busy ? 'var(--n100)' : bg,
  color: busy ? 'var(--sub)' : color, fontSize: 11.5, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
});

export function NoticeLine({ notice }: { notice: ReviewNotice | null }) {
  if (!notice) return null;
  const color = notice.tone === 'ok' ? 'var(--green-700)' : notice.tone === 'warn' ? 'var(--amber-700)' : '#dc2626';
  return <p role={notice.tone === 'error' ? 'alert' : 'status'} style={{ fontSize: 11, color, margin: 0 }}>{notice.text}</p>;
}

export default function ContentReviewBar({ content }: { content: ContentDetail }) {
  const { submit, pending, notice } = useContentReview(content.id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const locked = content.publish?.active_claim === true;
  const disabled = pending || locked;
  const run = (d: ReviewDecision, r?: string, onDone?: () => void) => submit(d, content.updated_at, r, onDone);
  const rs = content.review_status;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>검토</span>
        <span style={{ fontSize: 11, color: 'var(--sub)' }}>
          {REVIEW_LABEL[rs] ?? rs}
          {content.reviewed_at ? ` · ${new Date(content.reviewed_at).toLocaleString('ko-KR')}` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rs === 'pending_review' && !rejecting && (
            <>
              <button type="button" disabled={disabled} onClick={() => run('approve')} style={btn('var(--blue-500)', '#fff', 'var(--blue-500)', disabled)}>승인</button>
              <button type="button" disabled={disabled} onClick={() => setRejecting(true)} style={btn('var(--surface)', '#b91c1c', '#fecaca', disabled)}>반려</button>
            </>
          )}
          {rs === 'rejected' && (
            <button type="button" disabled={disabled} onClick={() => run('request_review')} style={btn('var(--surface)', 'var(--text)', 'var(--border)', disabled)}>재검토 요청</button>
          )}
          {rs === 'approved' && (
            <button
              type="button" disabled={disabled}
              onClick={() => { if (window.confirm('승인을 철회하고 검토 대기로 되돌릴까요?\n이미 외부에 게시된 글은 삭제되지 않습니다.')) run('request_review'); }}
              style={btn('var(--surface)', 'var(--sub)', 'var(--border)', disabled)}
            >
              승인 철회
            </button>
          )}
        </div>
      </div>

      {rejecting && rs === 'pending_review' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="반려 사유 (선택, 최대 500자)"
            aria-label="반려 사유"
            rows={2}
            style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)', padding: '6px 8px', fontSize: 12, fontFamily: 'inherit', resize: 'vertical', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--sub)', marginRight: 'auto' }}>{reason.length}/{REASON_MAX}</span>
            <button type="button" disabled={pending} onClick={() => { setRejecting(false); setReason(''); }} style={btn('var(--surface)', 'var(--sub)', 'var(--border)', pending)}>취소</button>
            <button
              type="button" disabled={disabled}
              onClick={() => run('reject', reason, () => { setRejecting(false); setReason(''); })}
              style={btn('#dc2626', '#fff', '#dc2626', disabled)}
            >
              반려 확정
            </button>
          </div>
        </div>
      )}

      {locked && <p style={{ fontSize: 11, color: 'var(--amber-700)', margin: 0 }}>발행이 진행 중이라 검토 상태를 바꿀 수 없습니다.</p>}
      {rs === 'pending_review' && !locked && (
        <p style={{ fontSize: 12, color: 'var(--sub)', margin: 0 }}>승인해도 즉시 게시되지 않습니다. 다음 발행 주기에 게시됩니다.</p>
      )}
      <NoticeLine notice={notice} />
    </div>
  );
}
