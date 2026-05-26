// lib/utils/case.ts — Prisma camelCase → snake_case 변환
// Prisma가 반환하는 camelCase 필드를 클라이언트 타입(types/db.ts)의 snake_case에 맞춘다.

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** 단일 객체의 키를 camelCase → snake_case로 변환 (1단계만) */
export function toSnakeCase<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnake(key)] = value;
  }
  return result;
}
