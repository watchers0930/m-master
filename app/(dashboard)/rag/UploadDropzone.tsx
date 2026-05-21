'use client';

import { useRef, useState, type DragEvent } from 'react';
import { uploadRagDoc } from '@/lib/api/rag';

const ALLOWED_EXTS = ['.pdf', '.md', '.txt', '.docx'];

interface UploadDropzoneProps {
  onUploaded: (docId: string, filename: string) => void;
}

export function UploadDropzone({ onUploaded }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      setError(`지원 형식: ${ALLOWED_EXTS.join(', ')}`);
      return;
    }
    setError('');
    setUploading(true);
    const res = await uploadRagDoc(file);
    setUploading(false);
    if (res.error) {
      setError(res.error.message);
    } else if (res.data) {
      onUploaded(res.data.doc_id, file.name);
    }
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  };

  return (
    <div>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{ borderRadius: 10, border: `2px dashed ${dragging ? 'var(--blue-400)' : 'var(--border)'}`, background: dragging ? 'var(--blue-50)' : 'var(--n50)', padding: '36px 24px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer', transition: 'all 0.12s' }}
      >
        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ fontSize: 12, color: 'var(--sub)' }}>업로드 중...</p>
          </div>
        ) : (
          <>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--n200)" strokeWidth="1.5" strokeLinecap="round" style={{ margin: '0 auto 10px' }}>
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
            </svg>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--blue-700)', marginBottom: 4 }}>파일을 드래그하거나 클릭하여 업로드</p>
            <p style={{ fontSize: 11, color: 'var(--sub)' }}>{ALLOWED_EXTS.join(', ')} · 최대 20MB</p>
          </>
        )}
        <input ref={inputRef} type="file" accept={ALLOWED_EXTS.join(',')} style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await handleFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p style={{ marginTop: 6, fontSize: 11, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}
