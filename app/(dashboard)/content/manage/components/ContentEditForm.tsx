// 콘텐츠 수정 폼 — topic·본문·키워드 (설계 §4.2). 저장 시 expected_updated_at(CAS) 동봉.
// 길이 제한은 입력 편의용 — 최종 검증은 서버 strict 스키마. 이미지 변경은 기존 regen 경로만.
'use client';

import { useState } from 'react';
import { useContentEdit } from '@/hooks/useContentEdit';
import type { ReviewNotice } from '@/hooks/useContentReview';
import type { ContentDetail } from '@/types/content-review';
import { NoticeLine } from './ContentReviewBar';

const TOPIC_MAX = 500;
const BODY_MAX = 50_000;
const KEYWORD_MAX = 50;
const KEYWORDS_MAX = 20;

function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  for (const k of raw.split(',')) {
    const t = k.trim();
    if (t) seen.add(t);
  }
  return Array.from(seen);
}

const field: React.CSSProperties = {
  width: '100%', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)',
  padding: '7px 9px', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit',
};
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 4 };

interface Props {
  content: ContentDetail;
  onClose: () => void;
  onResult: (notice: ReviewNotice, kind: 'saved' | 'conflict') => void;
}

export default function ContentEditForm({ content, onClose, onResult }: Props) {
  // 편집 시작 시점 스냅샷 — 초안의 기준 버전(CAS). 이후 재조회로 content 가 바뀌어도 고정
  const [base] = useState(content);
  const { save, pending, notice } = useContentEdit(base, onResult);
  const [topic, setTopic] = useState(base.topic);
  const [body, setBody] = useState(base.text_body ?? '');
  const [keywordsRaw, setKeywordsRaw] = useState((base.keywords ?? []).join(', '));
  const outdated = content.updated_at !== base.updated_at;

  const keywords = parseKeywords(keywordsRaw);
  const kwTooLong = keywords.find((k) => k.length > KEYWORD_MAX);
  const inputError =
    !topic.trim() ? '토픽을 입력하세요.'
    : keywords.length > KEYWORDS_MAX ? `키워드는 최대 ${KEYWORDS_MAX}개입니다.`
    : kwTooLong ? `키워드는 ${KEYWORD_MAX}자 이하여야 합니다: ${kwTooLong.slice(0, 20)}…`
    : null;

  const resetsReview = base.origin === 'auto' && base.review_status === 'approved';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {outdated && (
        <p role="alert" style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', borderRadius: 6, padding: '6px 10px', margin: 0 }}>
          편집 중 다른 곳에서 이 콘텐츠가 변경되었습니다. 저장하면 충돌로 거부되며 최신 내용을 다시 불러옵니다.
        </p>
      )}
      {resetsReview && (
        <p role="note" style={{ fontSize: 11, color: 'var(--amber-700)', background: 'var(--amber-100)', borderRadius: 6, padding: '6px 10px', margin: 0 }}>
          승인된 자동 생성 글입니다. 내용을 저장하면 다시 검토 대기로 바뀝니다.
        </p>
      )}
      <div>
        <label style={label} htmlFor="edit-topic">토픽</label>
        <input id="edit-topic" style={field} value={topic} maxLength={TOPIC_MAX} onChange={(e) => setTopic(e.target.value)} />
      </div>
      <div>
        <label style={label} htmlFor="edit-keywords">키워드 (쉼표로 구분, 최대 {KEYWORDS_MAX}개)</label>
        <input id="edit-keywords" style={field} value={keywordsRaw} onChange={(e) => setKeywordsRaw(e.target.value)} />
      </div>
      <div>
        <label style={label} htmlFor="edit-body">본문</label>
        <textarea
          id="edit-body" style={{ ...field, minHeight: 320, resize: 'vertical', lineHeight: 1.6 }}
          value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)}
        />
        <p style={{ fontSize: 12, color: 'var(--sub)', margin: '4px 0 0', textAlign: 'right' }}>{body.length.toLocaleString()} / {BODY_MAX.toLocaleString()}자</p>
      </div>

      {inputError && <p role="alert" style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{inputError}</p>}
      <NoticeLine notice={notice} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={pending} onClick={onClose}>취소</button>
        <button
          type="button" className="btn btn-primary" style={{ fontSize: 12, opacity: pending ? 0.7 : 1 }}
          disabled={pending || !!inputError}
          onClick={() => save({ topic: topic.trim(), text_body: body, keywords })}
        >
          {pending ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
