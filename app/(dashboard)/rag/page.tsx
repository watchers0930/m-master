'use client';

import { useState, useEffect } from 'react';
import { UploadDropzone } from './UploadDropzone';
import { DocList } from './DocList';
import { listRagDocs } from '@/lib/api/rag';
import type { RagDocument } from '@/types/db';

export default function RagPage() {
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRagDocs().then((res) => {
      setDocs(res.data ?? []);
      setLoading(false);
    });
  }, []);

  const handleUploaded = (docId: string, filename: string) => {
    const newDoc: RagDocument = {
      id: docId, owner_id: 'owner', title: filename,
      source_type: filename.endsWith('.pdf') ? 'pdf' : filename.endsWith('.md') ? 'md' : 'docx',
      storage_path: null, status: 'uploaded', created_at: new Date().toISOString(),
    };
    setDocs((prev) => [...prev, newDoc]);
  };

  const indexedCount = docs.filter((d) => d.status === 'indexed').length;
  const pendingCount = docs.filter((d) => d.status === 'uploaded').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>

      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>RAG 문서 관리</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>업로드한 문서를 벡터 인덱싱하여 콘텐츠 생성에 활용합니다</p>
      </div>

      {/* 요약 배지 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--green-100)', border: '1px solid #bbf7d0', borderRadius: 8, padding: '5px 12px', fontSize: 11, color: 'var(--green-700)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green-500)', display: 'inline-block' }} />
          인덱싱 완료 {indexedCount}건
        </div>
        {pendingCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--amber-100)', border: '1px solid #fde68a', borderRadius: 8, padding: '5px 12px', fontSize: 11, color: 'var(--amber-700)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber-500)', display: 'inline-block' }} />
            인덱싱 대기 {pendingCount}건
          </div>
        )}
        <span style={{ fontSize: 11, color: 'var(--sub)', display: 'flex', alignItems: 'center' }}>총 {docs.length}건</span>
      </div>

      {/* 업로드 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span className="card-title">문서 업로드</span>
        </div>
        <div style={{ padding: 16 }}>
          <UploadDropzone onUploaded={handleUploaded} />
        </div>
      </div>

      {/* 문서 목록 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
          </svg>
          <span className="card-title">등록된 문서</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>{docs.length}건</span>
        </div>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <DocList docs={docs} onDocsChange={setDocs} />
        )}
      </div>

      {/* 안내 */}
      <div style={{ display: 'flex', gap: 8, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 8, padding: '10px 14px', fontSize: 11.5, color: 'var(--blue-700)' }}>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>업로드 후 <strong>인덱싱</strong> 버튼을 클릭해야 콘텐츠 생성 시 참조됩니다. 인덱싱은 OpenAI text-embedding-3-small을 사용하며 문서 크기에 따라 수초~수십초 소요됩니다.</span>
      </div>

    </div>
  );
}
