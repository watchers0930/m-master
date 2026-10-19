import type { EngineId, Frequency } from "@/types/visibility";
export function kstDate(now: Date) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function periodBucket(frequency: Frequency, now: Date) {
  const local = new Date(`${kstDate(now)}T00:00:00Z`);
  if (frequency === "weekly")
    local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}
export function runKey(
  queryId: string,
  engine: EngineId,
  frequency: Frequency,
  now = new Date(),
) {
  return `${queryId}:${engine}:${frequency}:${periodBucket(frequency, now)}`;
}

/** Half-open UTC bounds for a KST calendar bucket, matching periodBucket(). */
export function periodRange(frequency: Frequency, now: Date) {
  const start = new Date(`${periodBucket(frequency, now)}T00:00:00+09:00`);
  return {
    gte: start,
    lt: new Date(start.getTime() + (frequency === "weekly" ? 7 : 1) * 86400000),
  };
}
