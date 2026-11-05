import { Prisma, type PrismaClient } from '@prisma/client';

type CreateInput = Omit<Prisma.ContentUncheckedCreateInput,
  'origin' | 'reviewStatus' | 'reviewedAt' | 'reviewedBy'> & { origin: 'manual' | 'auto' };
/** The only Content insert boundary. Review status is always derived by the server. */
export async function createContentRecord(db: Prisma.TransactionClient | PrismaClient, input: CreateInput) {
  const { origin, ...data } = input;
  if (origin !== 'auto' && origin !== 'manual') throw new Error('Content origin required');
  return db.content.create({ data: {
    ...data, origin, reviewStatus: origin === 'auto' ? 'pending_review' : 'approved',
    reviewedAt: null, reviewedBy: null,
  }, select: { id: true } });
}
/**
 * 파생 콘텐츠(변환·카페 파생 등)의 origin. 원본이 auto이거나 승인 상태가 아니면 auto(→ pending_review)를 물려받는다.
 * 사람이 직접 쓰고 승인된 원본의 변환만 manual(→ approved)이 된다.
 */
export function derivedOrigin(parent: { origin: string; reviewStatus: string }): 'manual' | 'auto' {
  return parent.origin === 'manual' && parent.reviewStatus === 'approved' ? 'manual' : 'auto';
}
