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
