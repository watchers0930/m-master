// lib/rag/retriever.ts — pgvector cosine 유사도 검색 (top-K)
// plan.md S7.2 쿼리 준수

import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/openai/embedding';
import { Prisma } from '@prisma/client';

export interface RetrieveOptions {
  query: string;
  ownerId: string;
  k?: number;         // 기본 5
}

export interface RetrievedChunk {
  id: string;
  content: string;
  similarity: number;
  docId: string;
}

export async function retrieveTopK(
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const { query, ownerId, k = 5 } = options;

  // 1) 쿼리 임베딩
  const { embedding } = await embedText(query);

  // 2) pgvector cosine 검색 — raw SQL (plan.md S7.2)
  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw<
    { id: string; docId: string; content: string; tokens: number; similarity: number }[]
  >(
    Prisma.sql`
      SELECT
        id,
        doc_id AS "docId",
        content,
        tokens,
        1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM rag_chunks
      WHERE doc_id IN (
        SELECT id FROM rag_documents WHERE owner_id = ${ownerId}
      )
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${k}
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    similarity: row.similarity ?? 0,
    docId: row.docId,
  }));
}

// ----------------------------------------------------------------
// RAG 컨텍스트 문자열 조합 (프롬프트 주입용)
// ----------------------------------------------------------------
export function buildRagContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';

  const sections = chunks
    .map((c, i) => `[참고자료 ${i + 1}] (유사도: ${c.similarity.toFixed(3)})\n${c.content}`)
    .join('\n\n---\n\n');

  return `아래는 관련 참고자료입니다:\n\n${sections}`;
}
