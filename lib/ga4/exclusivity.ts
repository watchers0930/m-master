import type { Prisma, PrismaClient } from '@prisma/client';
// errors (not http): this module also runs from the operator CLI (scripts/ga4/bind.ts) outside Next.
import { VisibilityError } from '@/lib/visibility/errors';
type Db = Prisma.TransactionClient | PrismaClient;
/**
 * GA4 속성(property)·스트림 소유 배타성 — 서비스 계정이 모든 소유자에게 공용이므로
 * 하나의 GA4 속성(과 그 스트림)은 한 소유자만 연결할 수 있다.
 * (같은 속성을 두 소유자가 묶으면 hostName 차원이 없는 실시간 보고서가 서로의 방문자를 보여주고,
 *  다른 소유자의 속성을 묶어 그 데이터를 읽는 것도 막지 못한다.)
 * 존재 여부만 돌려주며 다른 소유자의 어떤 값도 노출하지 않는다.
 */
export async function ga4PropertyHeldByOther(db: Db, ownerId: string, propertyId: string, streamId?: string | null) {
  const other = await db.ga4Binding.findFirst({ where: { ownerId: { not: ownerId },
    OR: [{ propertyId }, ...(streamId ? [{ streamId }] : [])] }, select: { id: true } });
  return Boolean(other);
}
/** 바인딩 트랜잭션 안에서 호출. 같은 속성 동시 바인딩은 advisory lock으로 직렬화한 뒤 확인한다. */
export async function assertGa4PropertyExclusive(tx: Prisma.TransactionClient, ownerId: string, propertyId: string, streamId?: string | null) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ga4_property:' + propertyId}))`;
  if (streamId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ga4_stream:' + streamId}))`;
  if (await ga4PropertyHeldByOther(tx, ownerId, propertyId, streamId))
    throw new VisibilityError('ga4_property_bound', '이미 다른 계정에 연결된 GA4 속성입니다.', 409);
}
