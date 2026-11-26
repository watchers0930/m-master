// lib/ops/report/types.ts — 운영 아침 보고서(매일 08:00 KST, 대장 수신) 공통 타입.
// 점검 하나 = 판정(level) + 한 줄 요약 + 세부 줄. 점검은 서로 독립이라 하나가 실패해도 보고서는 나간다(build.ts).
export type CheckLevel = "ok" | "warn" | "error" | "info";

export interface CheckResult {
  key: string;
  title: string;
  level: CheckLevel;
  summary: string;
  lines: string[];
}

export interface CheckContext {
  now: Date;
}

export type Check = (ctx: CheckContext) => Promise<CheckResult>;

export const LEVEL_MARK: Record<CheckLevel, string> = {
  error: "🔴 이상",
  warn: "🟡 주의",
  ok: "🟢 정상",
  info: "⚪ 참고",
};

/** 'n시간 전' / 'n일 전' — 보고서 문구용(기준 시각과의 차이). */
export function ago(at: Date | null | undefined, now: Date): string {
  if (!at) return "기록 없음";
  const minutes = Math.round((now.getTime() - at.getTime()) / 60000);
  if (minutes < 60) return `${Math.max(0, minutes)}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

export const krw = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
