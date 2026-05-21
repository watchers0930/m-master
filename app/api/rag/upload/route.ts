// app/api/rag/upload/route.ts
// POST multipart/form-data: file → Storage → rag_documents insert
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { upload, remove } from '@/lib/storage';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import type { SourceType } from '@/types/db';

const ALLOWED_MIME: Record<string, SourceType> = {
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'text/plain': 'md', // .md 파일이 text/plain으로 오는 경우
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(request: NextRequest) {
  // 1) 세션 검증
  const session = await requireSession();
  const ownerId = session.user.id;

  // 2) multipart 파싱
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'multipart 파싱 실패' } }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: 'validation', message: 'file 필드 필수' } }, { status: 400 });
  }

  // 3) 파일 검증
  const sourceType = ALLOWED_MIME[file.type];
  if (!sourceType) {
    // 확장자로 재판단
    const ext = file.name.split('.').pop()?.toLowerCase();
    const extMap: Record<string, SourceType> = { pdf: 'pdf', md: 'md', docx: 'docx' };
    const fallback = ext ? extMap[ext] : undefined;
    if (!fallback) {
      return NextResponse.json(
        { error: { code: 'validation', message: 'pdf, md, docx 파일만 허용' } },
        { status: 400 },
      );
    }
  }

  const finalSourceType: SourceType = sourceType ?? (() => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const extMap: Record<string, SourceType> = { pdf: 'pdf', md: 'md', docx: 'docx' };
    return extMap[ext ?? ''] as SourceType;
  })();

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: 'validation', message: `파일 크기 초과 (최대 ${MAX_FILE_SIZE / 1024 / 1024}MB)` } },
      { status: 400 },
    );
  }

  const timestamp = Date.now();
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `rag/${ownerId}/${timestamp}_${safeFilename}`;

  // 4) Storage 업로드
  const arrayBuffer = await file.arrayBuffer();
  try {
    await upload('rag-documents', storagePath, Buffer.from(arrayBuffer));
  } catch (storageError) {
    console.error('[rag/upload] storage upload error:', storageError);
    return NextResponse.json(
      { error: { code: 'internal', message: 'Storage 업로드 실패' } },
      { status: 500 },
    );
  }

  // 5) rag_documents insert
  let docData;
  try {
    docData = await prisma.ragDocument.create({
      data: {
        ownerId,
        title: file.name,
        sourceType: finalSourceType,
        storagePath,
        status: 'uploaded',
      },
      select: { id: true },
    });
  } catch (dbError) {
    console.error('[rag/upload] db insert error:', dbError);
    // storage 롤백 시도
    await remove('rag-documents', [storagePath]);
    return NextResponse.json(
      { error: { code: 'internal', message: 'DB insert 실패' } },
      { status: 500 },
    );
  }

  // 6) audit_log
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.RAG_UPLOAD,
    targetType: 'rag_document',
    targetId: docData.id,
    payload: { filename: file.name, source_type: finalSourceType, size: file.size },
  });

  return NextResponse.json({ data: { doc_id: docData.id }, error: null }, { status: 201 });
}
