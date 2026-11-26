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
/**
 * 실패 뒤 재시도 대기(1분 × 2^(n-1)). 상한은 크론 간격(24시간, vercel.json "0 0 * * *")보다 짧아야 한다 —
 * 상한이 24시간이면 처리 시각(00:00:47) + 24시간 > 다음 크론 시작(00:00:00)이라 다음 날을 건너뛰어 '하루 걸러 실행'이 된다
 * (운영 11-23·11-25 결측, 실패 12회째부터). 하루 1번 도는 크론에서 24시간 미만 대기는 '다음 실행에 다시'와 같다.
 */
export const RETRY_CAP_MS = 20 * 3600000;
export function retryDelayMs(failures: number) {
  return Math.min(RETRY_CAP_MS, 60000 * 2 ** (Math.max(1, failures) - 1));
}
