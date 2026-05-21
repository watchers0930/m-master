// lib/api/rag.ts — RAG 문서 관리 API 래퍼 (mock 포함)
import type { ApiResponse, RagUploadResponse, RagIndexResponse } from '@/types/api';
import type { RagDocument } from '@/types/db';

// ── Mock 데이터 ───────────────────────────────────────────────────

let MOCK_DOCS: RagDocument[] = [
  {
    id: 'd1',
    owner_id: 'owner',
    title: '부동산등기법_2024.pdf',
    source_type: 'pdf',
    storage_path: 'rag/d1/부동산등기법_2024.pdf',
    status: 'indexed',
    created_at: '2026-04-20T08:00:00Z',
  },
  {
    id: 'd2',
    owner_id: 'owner',
    title: 'VESTRA_서비스가이드_v1.0.md',
    source_type: 'md',
    storage_path: 'rag/d2/가이드.md',
    status: 'indexed',
    created_at: '2026-04-25T10:00:00Z',
  },
  {
    id: 'd3',
    owner_id: 'owner',
    title: '법인설립절차_안내서.docx',
    source_type: 'docx',
    storage_path: 'rag/d3/법인설립.docx',
    status: 'uploaded',
    created_at: '2026-05-05T09:00:00Z',
  },
];

// ── API 함수 ──────────────────────────────────────────────────────

export async function listRagDocs(): Promise<ApiResponse<RagDocument[]>> {
  // TODO: BE 연동 후 실제 fetch로 교체
  return { data: [...MOCK_DOCS], error: null };
}

export async function uploadRagDoc(
  file: File
): Promise<ApiResponse<RagUploadResponse>> {
  await new Promise((r) => setTimeout(r, 1500));

  const newDoc: RagDocument = {
    id: `d${Date.now()}`,
    owner_id: 'owner',
    title: file.name,
    source_type: file.name.endsWith('.pdf')
      ? 'pdf'
      : file.name.endsWith('.md')
      ? 'md'
      : 'docx',
    storage_path: `rag/${Date.now()}/${file.name}`,
    status: 'uploaded',
    created_at: new Date().toISOString(),
  };

  MOCK_DOCS = [...MOCK_DOCS, newDoc];
  return { data: { doc_id: newDoc.id }, error: null };
}

export async function indexRagDoc(
  docId: string
): Promise<ApiResponse<RagIndexResponse>> {
  // TODO: BE 연동
  await new Promise((r) => setTimeout(r, 3000));

  MOCK_DOCS = MOCK_DOCS.map((d) =>
    d.id === docId ? { ...d, status: 'indexed' as const } : d
  );

  return { data: { chunks: Math.floor(Math.random() * 40) + 10 }, error: null };
}

export async function deleteRagDoc(docId: string): Promise<ApiResponse<null>> {
  // TODO: BE 연동
  await new Promise((r) => setTimeout(r, 500));
  MOCK_DOCS = MOCK_DOCS.filter((d) => d.id !== docId);
  return { data: null, error: null };
}
