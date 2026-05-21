// app/api/rag/doc/[id]/route.ts
// DELETE /api/rag/doc/:id → rag_documents 삭제 (cascade로 chunks도 삭제) + Storage 파일 제거
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { remove } from '@/lib/storage';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  // 1) 세션 검증
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id: docId } = await params;

  // UUID 형식 최소 검증
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(docId)) {
    return NextResponse.json({ error: { code: 'validation', message: '유효하지 않은 id' } }, { status: 400 });
  }

  // 2) 문서 조회 (owner 확인)
  const doc = await prisma.ragDocument.findFirst({
    where: { id: docId, ownerId },
    select: { id: true, storagePath: true },
  });

  if (!doc) {
    return NextResponse.json({ error: { code: 'not_found', message: '문서를 찾을 수 없습니다' } }, { status: 404 });
  }

  // 3) DB 삭제 (cascade → rag_chunks도 삭제)
  try {
    await prisma.ragDocument.delete({ where: { id: docId } });
  } catch (deleteError) {
    console.error('[rag/doc] delete error:', deleteError);
    return NextResponse.json({ error: { code: 'internal', message: 'DB 삭제 실패' } }, { status: 500 });
  }

  // 4) Storage 파일 제거 (best-effort)
  if (doc.storagePath) {
    try {
      await remove('rag-documents', [doc.storagePath]);
    } catch (storageError) {
      console.error('[rag/doc] storage remove error:', storageError);
      // 서비스 중단 불필요 — 로그만
    }
  }

  // 5) audit_log
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.RAG_DELETE,
    targetType: 'rag_document',
    targetId: docId,
  });

  return NextResponse.json({ data: { deleted: true }, error: null });
}
