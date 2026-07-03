'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RichEditor } from './RichEditor';
import { createEditorDoc, updateEditorDoc, deleteEditorDoc, scheduleEditorDoc } from '@/lib/api/editor';
import type { IdeaDoc, IdeaJob, IdeaChannel } from '@/types/editor';

const CHANNEL_LABELS: Record<IdeaChannel, string> = {
  blog: '블로그', instagram: '인스타그램', facebook: '페이스북', naver_cafe: '네이버 카페',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '예약 대기', processing: '발행 중', done: '발행 완료', failed: '발행 실패',
};

interface Props {
  doc?: IdeaDoc | null;
}

export function EditorWorkspace({ doc }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(doc?.title ?? '');
  const [body, setBody] = useState(doc?.body ?? '<p><br></p>');
  const [channel, setChannel] = useState<IdeaChannel>(doc?.channel ?? 'blog');
  const [notes, setNotes] = useState(doc?.notes ?? '');
  const [scheduledAt, setScheduledAt] = useState(
    doc?.publishJob?.scheduledAt ? doc.publishJob.scheduledAt.slice(0, 16) : ''
  );
  const [job, setJob] = useState<IdeaJob | null>(doc?.publishJob ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const extractImages = (html: string) => {
    const matches = html.matchAll(/<img[^>]+src="([^"]+)"/g);
    return [...matches].map(m => m[1]);
  };

  const handleBody = useCallback((html: string) => setBody(html), []);

  const handleSave = async () => {
    setError('');
    setSaving(true);
    const payload = { title, body, channel, notes: notes || null, bodyImageUrls: extractImages(body) };

    if (doc?.id) {
      const { error: err } = await updateEditorDoc(doc.id, payload);
      if (err) { setError(err); setSaving(false); return; }
      router.refresh();
    } else {
      const { data, error: err } = await createEditorDoc(payload);
      if (err || !data) { setError(err ?? '저장 실패'); setSaving(false); return; }
      router.replace(`/editor/${data.id}`);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!doc?.id || !confirm('문서를 삭제하시겠습니까?')) return;
    await deleteEditorDoc(doc.id);
    router.push('/editor');
  };

  const handleSchedule = async () => {
    if (!doc?.id) { setError('먼저 문서를 저장하세요.'); return; }
    const { data, error: err } = await scheduleEditorDoc(doc.id, scheduledAt || null);
    if (err) { setError(err); return; }
    setJob(data as IdeaJob | null);
  };

  const handleCancelSchedule = async () => {
    if (!doc?.id || !confirm('예약을 취소하시겠습니까?')) return;
    const { error: err } = await scheduleEditorDoc(doc.id, null);
    if (err) { setError(err); return; }
    setJob(null);
    setScheduledAt('');
  };

  const jobStatusColor = job ? ({ pending: '#2563eb', processing: '#f97316', done: '#16a34a', failed: '#ef4444' }[job.status] ?? '#64748b') : '';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 20, alignItems: 'start' }}>
      {/* 에디터 메인 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="문서 제목"
            style={{ flex: 1, fontSize: 20, fontWeight: 700, border: 'none', borderBottom: '2px solid #e2e8f0', padding: '8px 0', outline: 'none', background: 'transparent', color: '#0f172a' }}
          />
        </div>

        <RichEditor value={body} onChange={handleBody} />

        {error && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {doc?.id && (
            <button onClick={handleDelete} style={{ padding: '9px 16px', background: '#fff', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}>
              삭제
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 20px', background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? '저장 중...' : doc?.id ? '저장' : '문서 생성'}
          </button>
        </div>
      </div>

      {/* 우측 레일 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16 }}>
        {/* 채널 */}
        <div style={{ background: '#fff', border: '1px solid #e4ebf5', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid #e4ebf5', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>채널</div>
          <div style={{ padding: 14 }}>
            <select value={channel} onChange={e => setChannel(e.target.value as IdeaChannel)}
              style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff' }}>
              {(Object.entries(CHANNEL_LABELS) as [IdeaChannel, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 발행 예약 */}
        <div style={{ background: '#fff', border: '1px solid #e4ebf5', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid #e4ebf5', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>발행 예약</div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!doc?.id && (
              <p style={{ fontSize: 12, color: '#64748b' }}>문서를 먼저 저장하면 예약할 수 있습니다.</p>
            )}
            {doc?.id && (
              <>
                {job ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: jobStatusColor, display: 'inline-block' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: jobStatusColor }}>{STATUS_LABELS[job.status]}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {job.scheduledAt ? new Date(job.scheduledAt).toLocaleString('ko-KR') : '-'}
                    </div>
                    {job.status === 'done' && job.externalUrl && (
                      <a href={job.externalUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#2563eb', textDecoration: 'underline' }}>발행된 글 보기</a>
                    )}
                    {job.status === 'failed' && job.error && (
                      <div style={{ fontSize: 11, color: '#ef4444' }}>{job.error}</div>
                    )}
                    {(job.status === 'pending') && (
                      <button onClick={handleCancelSchedule} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#b91c1c', cursor: 'pointer' }}>
                        예약 취소
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={e => setScheduledAt(e.target.value)}
                      style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 12 }}
                    />
                    <button onClick={handleSchedule} disabled={!scheduledAt}
                      style={{ padding: '8px', background: scheduledAt ? '#2563eb' : '#e2e8f0', color: scheduledAt ? '#fff' : '#94a3b8', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: scheduledAt ? 'pointer' : 'not-allowed' }}>
                      예약 등록 → 월간일정 반영
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 메모 */}
        <div style={{ background: '#fff', border: '1px solid #e4ebf5', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid #e4ebf5', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>메모</div>
          <div style={{ padding: 14 }}>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="내부 메모..."
              style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 12, resize: 'vertical', lineHeight: 1.6, outline: 'none' }} />
          </div>
        </div>
      </div>

      {/* 반응형 */}
      <style>{`
        @media(max-width:1100px){
          .editor-grid{grid-template-columns:1fr !important}
        }
      `}</style>
    </div>
  );
}
