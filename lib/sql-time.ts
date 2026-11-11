// lib/sql-time.ts — raw SQL 에서 timestamp(3)(시간대 없음) 컬럼을 다룰 때의 단일 경로.
// Prisma ORM 은 DateTime 을 UTC 벽시각으로 저장한다. 반면 raw SQL 의 Date 매개변수는 timestamptz 로 바인딩되고
// now() 도 timestamptz 라, timestamp 컬럼과 비교·대입하면 세션 TimeZone 으로 변환된다(세션이 UTC 가 아니면 9시간 등 어긋남).
// 아래 조각은 세션 TimeZone 과 무관하게 UTC 벽시각으로 고정한다(lib/ads/guard.ts 스냅샷 기록과 같은 방식).
import { Prisma } from '@prisma/client';

/** Date → timestamp(UTC 벽시각). raw SQL 비교·대입 전용. */
export const utcTimestamp = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** 현재 시각 → timestamp(UTC 벽시각). raw SQL 의 now() 대신. */
export const UTC_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
