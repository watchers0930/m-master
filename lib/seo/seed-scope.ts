// lib/seo/seed-scope.ts — 진단이 끝난 뒤 유료 후속 작업(자동 순위·지표 수집)이 고를 키워드 범위. 두 예약 경로가 같은 규칙을 쓴다.
import type { Prisma } from "@prisma/client";
import { checkpointSchema } from "./adapters/types";
import { normalizedKeyword } from "./keywords";
import type { Config } from "./plan";

/** 한 진단에서 후보가 될 수 있는 행 수의 상한: 키워드 발견 100 + Labs 100. 변형 정리 뒤 상한을 채우도록 넉넉히 읽는다. */
export const CANDIDATE_POOL = 200;

/**
 * 주제(씨앗) 키워드로 진단했으면 이번 키워드 발견 결과에 든 키워드만 — Labs가 돌려준 예전 무관 키워드가
 * 검색량이 크다는 이유로 유료 후속 작업을 가져가지 않게(codex MED). 결과가 없거나 깨졌으면 후보 없음.
 * 씨앗이 없으면 조건 없음(지금처럼 이번 진단의 모든 키워드).
 */
export async function seedKeywordScope(tx: Prisma.TransactionClient, auditId: string, config: Config) {
  if (!config.keywords?.length) return {};
  const task = await tx.seoTask.findFirst({
    where: { auditId, operation: "keywords_for_site" },
    select: { resultCheckpoint: true },
  });
  const parsed = checkpointSchema.safeParse(task?.resultCheckpoint);
  const found = parsed.success ? parsed.data.metrics.map((m) => normalizedKeyword(m.keyword)) : [];
  return { normalizedKeyword: { in: found } };
}

/**
 * 띄어쓰기만 다르고 검색량도 같은 행(근저당확인 320 / 근저당 확인 320)은 구글 광고가 묶어 보고하는 같은 수요다 —
 * 정렬 순서대로 하나만 골라 유료 작업이 겹치지 않게. 검색량이 다르면(nowhere / now here) 다른 검색어로 보고 둘 다 남긴다(codex 3차).
 * 2026-11-26 실측 응답의 띄어쓰기 변형 쌍은 모두 검색량이 같았다. 저장 데이터는 그대로 둔다.
 */
export function uniqueVariants<T extends { normalizedKeyword: string; searchVolume: number | null }>(rows: T[], limit: number): T[] {
  const seen = new Set<string>(), picked: T[] = [];
  for (const row of rows) {
    if (picked.length >= limit) break;
    const key = `${row.normalizedKeyword.replace(/\s+/g, "")}:${row.searchVolume ?? "?"}`;
    if (row.searchVolume !== null && seen.has(key)) continue;
    seen.add(key);
    picked.push(row);
  }
  return picked;
}
