// app/api/rag/upload/route.ts
// POST multipart/form-data: file → 즉시 텍스트추출 → 청킹 → 임베딩 → DB 저장
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { chunkFile } from '@/lib/rag/chunker';
import { embedTexts, calcEmbeddingKrw } from '@/lib/openai/embedding';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import type { SourceType } from '@/types/db';

const ALLOWED_MIME: Record<string, SourceType> = {
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'text/plain': 'md', // .md 파일이 text/plain으로 오는 경우
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const EMBED_BATCH_SIZE = 50;

export async function POST(request: NextRequest) {
  try {
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

  // 4) 텍스트 추출 + 청킹
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let chunks;
  try {
    chunks = await chunkFile(
      buffer,
      finalSourceType as Extract<SourceType, 'pdf' | 'md' | 'docx'>,
    );
  } catch (err) {
    console.error('[rag/upload] chunking error:', err);
    return NextResponse.json({ error: { code: 'internal', message: '텍스트 추출/청킹 실패' } }, { status: 500 });
  }

  if (chunks.length === 0) {
    return NextResponse.json({ error: { code: 'bad_request', message: '추출된 텍스트 없음' } }, { status: 400 });
  }

  // 5) 배치 임베딩
  let totalTokens = 0;
  const chunkInserts: Array<{
    chunkIndex: number;
    content: string;
    embedding: number[];
    tokens: number;
  }> = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    let embedResults;
    try {
      embedResults = await embedTexts(texts);
    } catch (err) {
      console.error('[rag/upload] embedding error:', err);
      return NextResponse.json({ error: { code: 'internal', message: '임베딩 실패' } }, { status: 500 });
    }

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const embed = embedResults[j];
      totalTokens += embed.tokens;
      chunkInserts.push({
        chunkIndex: chunk.chunk_index,
        content: chunk.content,
        embedding: embed.embedding,
        tokens: chunk.tokens,
      });
    }
  }

  // 6) rag_documents INSERT (즉시 indexed 상태, storagePath 없음)
  let docData;
  try {
    docData = await prisma.ragDocument.create({
      data: {
        ownerId,
        title: file.name,
        sourceType: finalSourceType,
        storagePath: null,
        status: 'indexed',
      },
      select: { id: true },
    });
  } catch (dbError) {
    console.error('[rag/upload] db insert error:', dbError);
    return NextResponse.json({ error: { code: 'internal', message: 'DB insert 실패' } }, { status: 500 });
  }

  // 7) rag_chunks 일괄 insert + pgvector 임베딩
  try {
    for (const chunk of chunkInserts) {
      const created = await prisma.ragChunk.create({
        data: {
          docId: docData.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokens: chunk.tokens,
        },
        select: { id: true },
      });

      const vectorLiteral = `[${chunk.embedding.join(',')}]`;
      await prisma.$executeRaw`
        UPDATE rag_chunks SET embedding = ${vectorLiteral}::vector
        WHERE id = ${created.id}
      `;
    }
  } catch (chunkError) {
    console.error('[rag/upload] chunk insert error:', chunkError);
    // 실패 시 문서 상태를 failed로 변경
    await prisma.ragDocument.update({ where: { id: docData.id }, data: { status: 'failed' } });
    return NextResponse.json({ error: { code: 'internal', message: '청크 저장 실패' } }, { status: 500 });
  }

  // 8) cost_ledger 적재
  const krw = calcEmbeddingKrw(totalTokens);
  await trackCost({ kind: 'embedding', tokensIn: totalTokens, tokensOut: 0, krw });

  // 9) audit_log
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.RAG_UPLOAD,
    targetType: 'rag_document',
    targetId: docData.id,
    payload: { filename: file.name, source_type: finalSourceType, size: file.size, chunks: chunks.length, tokens: totalTokens, krw },
  });

  return NextResponse.json({ data: { doc_id: docData.id, chunks: chunks.length }, error: null }, { status: 201 });

  } catch (err) {
    console.error('[rag/upload] unhandled error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'internal', message: `업로드 처리 실패: ${message}` } }, { status: 500 });
  }
}
