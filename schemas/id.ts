// schemas/id.ts — DB 엔티티 id 공용 검증 스키마 (단일 기준)
// Prisma 모델 id 는 @default(cuid()) 이지만, 이관·시드 데이터에 UUID 형식 id 가 섞여 있을 수 있으므로
// 형식(cuid/uuid)을 특정하지 않고 "안전한 식별자 문자"만 허용한다.
// 진짜 UUID 값(예: 클라이언트가 crypto.randomUUID() 로 만든 runKey)은 z.string().uuid() 를 그대로 쓴다.
import { z } from 'zod';

export const ENTITY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const entityId = z
  .string()
  .min(1, 'id가 비어 있습니다')
  .max(64, 'id가 너무 깁니다')
  .regex(ENTITY_ID_RE, '유효하지 않은 id');

/** 라우트 params 등 문자열 id 를 빠르게 검사할 때 사용 */
export function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_RE.test(value);
}
