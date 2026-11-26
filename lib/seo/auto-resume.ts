// lib/seo/auto-resume.ts — SEO 진단 화면 자동 이어가기 규칙(순수 함수). 동작은 app/(dashboard)/seo-audit/hooks/use-auto-resume.ts.
// 배경(2026-11-26): 서버는 요청 1번에 작업 2개만 처리하고(lib/seo/audit.ts processAudit), 다음 단계는 15분 재개 크론만 이어서
// 진단 1회가 45분 이상 걸렸다. 재개를 연달아 부르면 단계마다 수 초 — 남는 시간은 공급자 대기열뿐이다.
// 재개는 이미 예약된 작업만 진행하므로 추가 과금이 없고, 같은 작업 동시 처리는 서버 점유(claimTasks·leaseUntil)가 막는다.
import type { SeoAuditDTO } from "@/types/seo";

export const AUTO_RESUME_MIN_MS = 3_000;
export const AUTO_RESUME_MAX_MS = 20_000;
export const AUTO_RESUME_LIMIT_MS = 15 * 60_000; // 넘기면 멈추고 크론에 맡긴다

const ACTIVE = new Set(["pending", "claimed", "submitted"]);

/** 진행 여부를 비교할 서명: 진단 상태·비용·작업별 상태. */
export function progressSignature(a: Pick<SeoAuditDTO, "status" | "costKrw" | "tasks">): string {
  return JSON.stringify([a.status, a.costKrw, a.tasks.map((t) => `${t.operation}:${t.itemKey}:${t.status}`).sort()]);
}

/** 계속 이어갈 진단인가: 진행 중이고 남은 작업이 있다. */
export function shouldContinue(a: Pick<SeoAuditDTO, "status" | "tasks">): boolean {
  return a.status === "pending" && a.tasks.some((t) => ACTIVE.has(t.status));
}

/** 다음 대기: 진행이 있었으면 최소, 없었으면 두 배(최대 20초). */
export function nextDelay(progressed: boolean, previous: number): number {
  return progressed ? AUTO_RESUME_MIN_MS : Math.min(AUTO_RESUME_MAX_MS, Math.max(AUTO_RESUME_MIN_MS, previous * 2));
}
