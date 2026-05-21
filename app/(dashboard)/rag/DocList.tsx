'use client';

import { useState } from 'react';
import type { RagDocument } from '@/types/db';
import { indexRagDoc, deleteRagDoc } from '@/lib/api/rag';

interface DocListProps {
  docs: RagDocument[];
  onDocsChange: (docs: RagDocument[]) => void;
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF', md: 'MD', docx: 'DOC', url: 'URL', manual: 'TXT',
};
const SOURCE_TYPE_COLOR: Record<string, string> = {
  pdf: '#ef4444', md: '#22c55e', docx: '#3b82f6', url: '#8b5cf6', manual: '#6b7280',
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  uploaded: { bg: 'var(--amber-100)', color: 'var(--amber-700)', label: '업로드됨' },
  indexing: { bg: 'var(--blue-100)',  color: 'var(--blue-600)',  label: '인덱싱 중' },
  indexed:  { bg: 'var(--green-100)', color: 'var(--green-700)', label: '인덱싱 완료' },
  failed:   { bg: '#fee2e2',          color: '#dc2626',          label: '실패' },
};

export function DocList({ docs, onDocsChange }: DocListProps) {
  const [indexingIds, setIndexingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [indexedChunks, setIndexedChunks] = useState<Record<string, number>>({});

  const handleIndex = async (docId: string) => {
    setIndexingIds((prev) => new Set(prev).add(docId));
    const res = await indexRagDoc(docId);
    setIndexingIds((prev) => { const s = new Set(prev); s.delete(docId); return s; });
    if (res.data) {
      setIndexedChunks((prev) => ({ ...prev, [docId]: res.data!.chunks }));
      onDocsChange(docs.map((d) => d.id === docId ? { ...d, status: 'indexed' as const } : d));
    }
  };

  const handleDelete = async (docId: string) => {
    setDeletingIds((prev) => new Set(prev).add(docId));
    await deleteRagDoc(docId);
    onDocsChange(docs.filter((d) => d.id !== docId));
    setDeletingIds((prev) => { const s = new Set(prev); s.delete(docId); return s; });
  };

  if (docs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--n200)" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 10 }}>
          <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
        </svg>
        <p style={{ fontSize: 12, color: 'var(--sub)' }}>등록된 문서가 없습니다</p>
        <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>위 드롭존에 파일을 업로드하세요</p>
      </div>
    );
  }

  return (
    <div>
      {docs.map((doc) => {
        const isIndexing = indexingIds.has(doc.id);
        const isDeleting = deletingIds.has(doc.id);
        const chunks = indexedChunks[doc.id];
        const st = STATUS_STYLE[doc.status] ?? STATUS_STYLE.uploaded;
        const typeColor = SOURCE_TYPE_COLOR[doc.source_type] ?? '#6b7280';
        const typeLabel = SOURCE_TYPE_LABEL[doc.source_type] ?? '?';

        return (
          <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border2)', transition: 'background 0.1s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--n50)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            <div style={{ width: 32, height: 32, borderRadius: 6, background: typeColor, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {typeLabel}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</p>
              <p style={{ fontSize: 10.5, color: 'var(--sub)' }}>
                {new Date(doc.created_at).toLocaleDateString('ko-KR')}
                {chunks !== undefined && ` · ${chunks}개 청크`}
              </p>
            </div>
            <span style={{ background: st.bg, color: st.color, fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, flexShrink: 0 }}>{st.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {doc.status === 'uploaded' && (
                <button onClick={() => handleIndex(doc.id)} disabled={isIndexing} className="btn btn-teal" style={{ fontSize: 11, padding: '4px 10px', opacity: isIndexing ? 0.6 : 1 }}>
                  {isIndexing ? '인덱싱 중...' : '인덱싱'}
                </button>
              )}
              <button onClick={() => handleDelete(doc.id)} disabled={isDeleting} className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: '#dc2626', borderColor: '#fecaca', opacity: isDeleting ? 0.6 : 1 }}>
                {isDeleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
