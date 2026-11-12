// lib/ads/proposal-check.ts — 제안 payload 서버 검사(생성 propose.ts·편집 proposal-review.ts 공용). 순수 함수(I/O 없음).
// - checkPayload: 형태가 통과한 payload를 저장 가능한 값으로 만든다. 저장을 막는 위반은 problems로 돌려준다.
//   · 개수: LLM 그룹 2~5(extend_group은 1)·소재 2~3, 편집 그룹 1~5(extend_group 1)·소재 1~3(삭제 허용). 키워드 1~20.
//   · 입찰: invariants.ts checkProposalBid(정수, 70 ≤ bid ≤ proposalBidCeiling = min(maxBid, ⌊하루 상한/100⌋×10) — checkBid 위에 천장만 낮춘 것)만 쓴다.
//     범위 밖은 고치지 않고 위반이다. 생성(LLM·교정)·편집·승인 재검사가 모두 이 경로다.
//   · 키워드: collapseKeyword 후 같은 그룹 내 중복(keywordDedupeKey)은 뒤의 것을 버린다.
//     source='llm'이면 리서치 통계에 없는 키워드는 버리고(지어낸 키워드 금지) 키워드 문자열도 통계의 정규 표기로 바꾼다.
//     source='edit'이면 대장이 직접 넣은 키워드도 받는다(근거는 통계에 있으면 그 값, 없으면 qc·compIdx null).
//   · 근거(evidence)는 항상 통계로 덮어쓴다 — LLM·클라이언트가 보낸 값은 쓰지 않는다.
// - lintPayload: 키워드(lintKeyword)·소재(lintCreativeGroup) 린트. 남은 위반은 lintResult로 저장되고 승인을 막는다.
import type { ZodError } from "zod";
import type {
  AdProposalKind, ProposalEvidence, ProposalGroup, ProposalLintIssue, ProposalPayload, ProposalSourceKeyword,
} from "@/types/ads";
import { MAX_CREATIVES, MAX_GROUPS, type ProposalPayloadShape } from "@/schemas/ads-proposal";
import { AdsInvariantError, checkProposalBid, proposalBidRange, type Caps } from "./invariants";
import { collapseKeyword, keywordDedupeKey } from "./keyword-text";
import { lintCreativeGroup, lintKeyword } from "./lint";

export type Problem = { path: string; rule: string; message: string };
export type CheckSource = "llm" | "edit";
export type CheckContext = { kind: AdProposalKind; caps: Caps; stats: readonly ProposalSourceKeyword[]; source: CheckSource };

export const MAX_PROBLEMS = 30;
const BOUNDS: Record<CheckSource, { groups: Record<AdProposalKind, [number, number]>; creatives: [number, number] }> = {
  llm: { groups: { new_campaign: [2, MAX_GROUPS], extend_group: [1, 1] }, creatives: [2, MAX_CREATIVES] },
  edit: { groups: { new_campaign: [1, MAX_GROUPS], extend_group: [1, 1] }, creatives: [1, MAX_CREATIVES] },
};

export function evidenceOf(stat: ProposalSourceKeyword | undefined): ProposalEvidence {
  if (!stat) return { qc: null, compIdx: null, lt10: false };
  const qc = stat.pcQc === null && stat.mobileQc === null ? null : (stat.pcQc ?? 0) + (stat.mobileQc ?? 0);
  return { qc, compIdx: stat.compIdx, lt10: stat.lt10 };
}

export function statIndex(stats: readonly ProposalSourceKeyword[]): Map<string, ProposalSourceKeyword> {
  const index = new Map<string, ProposalSourceKeyword>();
  for (const s of stats) if (!index.has(keywordDedupeKey(s.keyword))) index.set(keywordDedupeKey(s.keyword), s);
  return index;
}

/** zod 위반 → 문제 목록(경로·고정 규칙명·zod 메시지). */
export function shapeProblems(error: ZodError): Problem[] {
  return error.issues.slice(0, MAX_PROBLEMS).map((i) => ({ path: i.path.join(".") || "(root)", rule: "schema", message: i.message }));
}

function bidProblem(value: unknown, caps: Caps, path: string, problems: Problem[]): number {
  try {
    return checkProposalBid(value, caps, path);
  } catch (error) {
    if (!(error instanceof AdsInvariantError)) throw error;
    const { min, max } = proposalBidRange(caps);
    problems.push({ path, rule: "bid-range", message: `입찰가는 ${min.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")}원 사이 정수여야 합니다.` });
    return NaN;
  }
}

function countProblem(path: string, n: number, [min, max]: [number, number], problems: Problem[]): void {
  if (n < min || n > max) problems.push({ path, rule: "count", message: `개수는 ${min}~${max}개여야 합니다(현재 ${n}개).` });
}

export function checkPayload(shape: ProposalPayloadShape, ctx: CheckContext): { payload: ProposalPayload; problems: Problem[] } {
  const problems: Problem[] = [];
  const bounds = BOUNDS[ctx.source];
  const index = statIndex(ctx.stats);
  countProblem("groups", shape.groups.length, bounds.groups[ctx.kind], problems);
  const groups: ProposalGroup[] = shape.groups.map((g, gi) => {
    const base = `groups.${gi}`;
    const bidAmt = bidProblem(g.bidAmt, ctx.caps, `${base}.bidAmt`, problems);
    countProblem(`${base}.creatives`, g.creatives.length, bounds.creatives, problems);
    const seen = new Set<string>();
    const keywords = g.keywords.flatMap((k, ki) => {
      const text = collapseKeyword(k.keyword);
      const key = keywordDedupeKey(text);
      const stat = index.get(key);
      if (seen.has(key) || (ctx.source === "llm" && !stat)) return [];
      seen.add(key);
      const bid = bidProblem(k.bidAmt, ctx.caps, `${base}.keywords.${ki}.bidAmt`, problems);
      return [{ keyword: ctx.source === "llm" && stat ? stat.keyword : text, bidAmt: bid, reason: k.reason, evidence: evidenceOf(stat) }];
    });
    if (keywords.length === 0)
      problems.push({ path: `${base}.keywords`, rule: "count", message: "리서치된 키워드가 하나도 없습니다. 제공된 키워드 목록에서만 고르세요." });
    const creatives = g.creatives.map((c) => ({ headline: c.headline, description: c.description }));
    return { name: g.name, bidAmt, keywords, creatives };
  });
  return { payload: { groups }, problems: problems.slice(0, MAX_PROBLEMS) };
}

export function lintPayload(payload: ProposalPayload): ProposalLintIssue[] {
  const out: ProposalLintIssue[] = [];
  payload.groups.forEach((g, group) => {
    g.keywords.forEach((k, index) => {
      for (const i of lintKeyword(k.keyword)) out.push({ group, target: "keyword", index, rule: i.rule, field: i.field, message: i.message });
    });
    lintCreativeGroup(g.creatives).forEach((issues, index) => {
      for (const i of issues) out.push({ group, target: "creative", index, rule: i.rule, field: i.field, message: i.message });
    });
  });
  return out;
}

/** 린트 위반 → 교정 요청용 문제 목록. */
export function lintProblems(issues: readonly ProposalLintIssue[]): Problem[] {
  return issues.slice(0, MAX_PROBLEMS).map((i) => ({
    path: `groups.${i.group}.${i.target === "keyword" ? "keywords" : "creatives"}.${i.index}.${i.field}`,
    rule: i.rule,
    message: i.message,
  }));
}
