// app/api/rag/index/route.ts
// POST { doc_id } → Storage 파일 다운로드 → 청킹 → embedding → rag_chunks insert
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { download } from '@/lib/storage';
import { chunkFile } from '@/lib/rag/chunker';
import { embedTexts, calcEmbeddingKrw } from '@/lib/openai/embedding';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import type { SourceType } from '@/types/db';

const RequestSchema = z.object({
  doc_id: z.string().min(1, 'doc_id는 필수입니다'),
});

// 배치 사이즈: OpenAI embedding API 한 번에 처리할 청크 수
const EMBED_BATCH_SIZE = 50;

export async function POST(request: NextRequest) {
  // 1) 세션 검증
  const session = await requireSession();
  const ownerId = session.user.id;

  // 2) zod 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { doc_id } = parsed.data;

  // 3) rag_documents 조회 (owner 확인)
  const doc = await prisma.ragDocument.findFirst({
    where: { id: doc_id, ownerId },
    select: { id: true, ownerId: true, storagePath: true, sourceType: true, status: true },
  });

  if (!doc) {
    return NextResponse.json({ error: { code: 'not_found', message: '문서를 찾을 수 없습니다' } }, { status: 404 });
  }

  if (doc.status === 'indexed') {
    return NextResponse.json({ error: { code: 'conflict', message: '이미 인덱싱된 문서입니다' } }, { status: 409 });
  }

  if (!doc.storagePath) {
    return NextResponse.json({ error: { code: 'internal', message: 'storage_path 없음' } }, { status: 500 });
  }

  // 4) Storage에서 파일 다운로드
  let fileData: Buffer;
  try {
    fileData = await download('rag-documents', doc.storagePath);
  } catch (dlError) {
    console.error('[rag/index] storage download error:', dlError);
    return NextResponse.json({ error: { code: 'internal', message: 'Storage 다운로드 실패' } }, { status: 500 });
  }

  const buffer = fileData;

  // 5) 청킹
  let chunks;
  try {
    chunks = await chunkFile(
      buffer,
      doc.sourceType as Extract<SourceType, 'pdf' | 'md' | 'docx'>,
    );
  } catch (err) {
    console.error('[rag/index] chunking error:', err);
    await prisma.ragDocument.update({ where: { id: doc_id }, data: { status: 'failed' } });
    return NextResponse.json({ error: { code: 'internal', message: '청킹 실패' } }, { status: 500 });
  }

  if (chunks.length === 0) {
    return NextResponse.json({ error: { code: 'bad_request', message: '추출된 텍스트 없음' } }, { status: 400 });
  }

  // 6) 배치 임베딩
  let totalTokens = 0;
  const chunkInserts: Array<{
    docId: string;
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
      console.error('[rag/index] embedding error:', err);
      await prisma.ragDocument.update({ where: { id: doc_id }, data: { status: 'failed' } });
      return NextResponse.json({ error: { code: 'internal', message: '임베딩 실패' } }, { status: 500 });
    }

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const embed = embedResults[j];
      totalTokens += embed.tokens;

      chunkInserts.push({
        docId: doc_id,
        chunkIndex: chunk.chunk_index,
        content: chunk.content,
        embedding: embed.embedding,
        tokens: chunk.tokens,
      });
    }
  }

  // 7) rag_chunks 일괄 insert (기존 청크 삭제 후 재삽입)
  await prisma.ragChunk.deleteMany({ where: { docId: doc_id } });

  // Insert chunks and then update embedding via raw SQL for pgvector
  for (const chunk of chunkInserts) {
    const created = await prisma.ragChunk.create({
      data: {
        docId: chunk.docId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokens: chunk.tokens,
      },
      select: { id: true },
    });

    // pgvector embedding update via raw SQL
    const vectorLiteral = `[${chunk.embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE rag_chunks SET embedding = ${vectorLiteral}::vector
      WHERE id = ${created.id}
    `;
  }

  // 8) 문서 상태 업데이트
  await prisma.ragDocument.update({ where: { id: doc_id }, data: { status: 'indexed' } });

  // 9) cost_ledger 적재
  const krw = calcEmbeddingKrw(totalTokens);
  await trackCost({ kind: 'embedding', tokensIn: totalTokens, tokensOut: 0, krw });

  // 10) audit_log
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.RAG_INDEX,
    targetType: 'rag_document',
    targetId: doc_id,
    payload: { chunks: chunks.length, tokens: totalTokens, krw },
  });

  return NextResponse.json({ data: { chunks: chunks.length }, error: null });
}
