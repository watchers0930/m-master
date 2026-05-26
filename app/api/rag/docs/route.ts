// app/api/rag/docs/route.ts
// GET → rag_documents 목록 조회 (owner 기준)
// 인증 필수

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await requireSession();
  const ownerId = session.user.id;

  const docs = await prisma.ragDocument.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      ownerId: true,
      title: true,
      sourceType: true,
      storagePath: true,
      status: true,
      createdAt: true,
    },
  });

  // snake_case로 변환 (프론트 타입 호환)
  const data = docs.map((d) => ({
    id: d.id,
    owner_id: d.ownerId,
    title: d.title,
    source_type: d.sourceType,
    storage_path: d.storagePath,
    status: d.status,
    created_at: d.createdAt.toISOString(),
  }));

  return NextResponse.json({ data, error: null });
}
