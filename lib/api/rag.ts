// lib/api/rag.ts — RAG 문서 관리 API 래퍼 (실제 서버 연동)
import type { ApiResponse, RagUploadResponse } from '@/types/api';
import type { RagDocument } from '@/types/db';

// ── API 함수 ──────────────────────────────────────────────────────

export async function listRagDocs(): Promise<ApiResponse<RagDocument[]>> {
  const res = await fetch('/api/rag/docs');
  const json = await res.json();
  if (!res.ok) return { data: null, error: json.error ?? { message: `HTTP ${res.status}` } };
  return { data: json.data ?? [], error: null };
}

export async function uploadRagDoc(
  file: File,
): Promise<ApiResponse<RagUploadResponse>> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/rag/upload', { method: 'POST', body: fd });
  const json = await res.json();
  if (!res.ok) return { data: null, error: json.error ?? { message: `HTTP ${res.status}` } };
  return { data: json.data, error: null };
}

export async function deleteRagDoc(docId: string): Promise<ApiResponse<null>> {
  const res = await fetch(`/api/rag/doc/${docId}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok) return { data: null, error: json.error ?? { message: `HTTP ${res.status}` } };
  return { data: null, error: null };
}
