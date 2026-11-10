// lib/ads/proposals.ts — AI 광고 제안 생성·조회(설계서 §5.5-3). 편집·승인·반려 상태기계는 proposal-review.ts.
// - 모든 진입점: 허용목록(assertAdsOwner) + 세션 ownerId 범위. 남의 제안·계정·광고그룹 id는 404(IDOR).
// - 생성 전제(설계서 §5.5-1 비즈채널): 계정이 active이고 비즈채널·공유예산이 있고 상한값이 유효해야 한다.
//   아니면 409 ads_account_not_ready — 키워드 리서치·LLM 호출·비용 0.
// - 월 예산 초과(isBudgetExceeded)면 429 budget_exceeded — 씨앗·리서치·LLM·비용 0. 별도 횟수 제한은 두지 않는다.
// - 씨앗: domainId가 있으면 collectSeeds(수동 > SEO > 컨설팅 전략, 소유자·도메인 범위), 없으면 수동 씨앗만(정제 후 최대 25).
// - 제안 행의 ownerId는 계정 행에서 복사한다(입력에서 받지 않는다). 상태는 pending_review로 시작한다.
// - DTO는 select로 필요한 컬럼만 읽는다. 계정 키·암호문은 어떤 경로로도 실리지 않는다.
import type { Prisma } from "@prisma/client";
import { getClient } from "@/lib/claude/chat";
import { isBudgetExceeded } from "@/lib/cost/budget";
import { prisma } from "@/lib/prisma";
import { adsProposalCreateSchema, adsProposalListSchema, type AdsProposalCreateInput, type AdsProposalListInput } from "@/schemas/ads-proposal";
import type {
  AdProposalDTO, AdProposalKind, AdProposalPage, AdProposalStatus, AdProposalSummaryDTO, ProposalLintResult, ProposalPayload,
  ProposalSourceKeyword,
} from "@/types/ads";
import { isEntityId } from "@/schemas/id";
import { assertAdsOwner } from "./access";
import { loadOwnedAccount, notFound, withAccountClient, type AdsDeps } from "./account-core";
import { AdsHttpError } from "./http";
import { caps, type Caps } from "./invariants";
import { collectSeeds, MAX_SEEDS, researchKeywords, sanitizeSeeds } from "./keywords";
import { generateProposal, type LlmClient } from "./propose";

export type ProposalDeps = AdsDeps & { llm?: LlmClient };

export const PROPOSAL_SELECT = {
  id: true, adAccountId: true, kind: true, targetAdgroupId: true, status: true, payload: true, lintResult: true,
  sourceKeywords: true, costKrw: true, failCode: true, reviewedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.AdProposalSelect;
type ProposalRow = Prisma.AdProposalGetPayload<{ select: typeof PROPOSAL_SELECT }>;

// 저장 값은 이 모듈·proposal-review.ts만 쓴다(형태 검사 후 저장). 읽을 때는 배열 여부만 방어한다.
export const payloadOf = (row: { payload: Prisma.JsonValue }): ProposalPayload => {
  const p = row.payload as ProposalPayload | null;
  return p && Array.isArray(p.groups) ? p : { groups: [] };
};
export const sourceKeywordsOf = (row: { sourceKeywords: Prisma.JsonValue }): ProposalSourceKeyword[] =>
  Array.isArray(row.sourceKeywords) ? (row.sourceKeywords as ProposalSourceKeyword[]) : [];
const lintOf = (row: { lintResult: Prisma.JsonValue }): ProposalLintResult | null => {
  const l = row.lintResult as ProposalLintResult | null;
  return l && Array.isArray(l.issues) ? l : null;
};
export const kindOf = (row: { kind: string }): AdProposalKind => (row.kind === "extend_group" ? "extend_group" : "new_campaign");

function toSummary(row: ProposalRow): AdProposalSummaryDTO {
  const payload = payloadOf(row);
  return {
    id: row.id, accountId: row.adAccountId, kind: kindOf(row), targetAdgroupId: row.targetAdgroupId, status: row.status as AdProposalStatus,
    groupCount: payload.groups.length, keywordCount: payload.groups.reduce((n, g) => n + g.keywords.length, 0),
    lintIssueCount: lintOf(row)?.issues.length ?? 0, costKrw: row.costKrw,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProposalDTO(row: ProposalRow): AdProposalDTO {
  return {
    ...toSummary(row), payload: payloadOf(row), lintResult: lintOf(row), sourceKeywords: sourceKeywordsOf(row),
    failCode: row.failCode, reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

export const lintResultOf = (issues: ProposalLintResult["issues"]): ProposalLintResult => ({ issues, checkedAt: new Date().toISOString() });

const notReady = () =>
  new AdsHttpError("ads_account_not_ready", "광고 계정이 연결·활성 상태이고 검수가 끝난 비즈채널이 선택돼 있어야 제안을 만들 수 있습니다.", 409);

function readyCaps(account: Awaited<ReturnType<typeof loadOwnedAccount>>): Caps {
  if (account.status !== "active" || !account.businessChannelId || !account.sharedBudgetId) throw notReady();
  try {
    return caps(account);
  } catch {
    throw notReady();
  }
}

function llmOf(deps: ProposalDeps): LlmClient {
  if (deps.llm) return deps.llm;
  try {
    return getClient();
  } catch {
    console.error("[ads] proposal LLM client unavailable");
    throw new AdsHttpError("ads_llm_unavailable", "AI 제안 생성을 호출하지 못했습니다. 잠시 후 다시 시도하세요.", 503);
  }
}

export async function createProposal(ownerId: string, input: AdsProposalCreateInput, deps: ProposalDeps = {}): Promise<AdProposalDTO> {
  assertAdsOwner(ownerId);
  const data = adsProposalCreateSchema.parse(input);
  const account = await loadOwnedAccount(ownerId, data.accountId);
  const accountCaps = readyCaps(account);
  if (data.kind === "extend_group") {
    const group = await prisma.adGroup.findFirst({
      where: { ownerId, adAccountId: account.id, naverId: data.targetAdgroupId }, select: { id: true },
    });
    if (!group) throw notFound();
  }
  // 월 예산(lib/cost/budget.ts, 콘텐츠 생성과 같은 기준·오류 형태) — 초과면 씨앗 수집·네이버 리서치·LLM 모두 하지 않는다
  if (await isBudgetExceeded(ownerId)) throw new AdsHttpError("budget_exceeded", "월 예산 한도 초과. 설정에서 한도를 조정하세요.", 429);
  const manual = data.seeds ?? [];
  const seeds = data.domainId ? await collectSeeds(ownerId, data.domainId, manual) : sanitizeSeeds(manual).slice(0, MAX_SEEDS);
  if (seeds.length === 0) throw new AdsHttpError("ads_no_seeds", "씨앗 키워드가 없습니다. 키워드를 입력하거나 도메인을 선택하세요.", 422);
  const llm = llmOf(deps);
  const stats = await withAccountClient(account, deps, (client) => researchKeywords(client, seeds));
  if (stats.length === 0) throw new AdsHttpError("ads_no_keywords", "키워드 도구가 쓸 수 있는 연관 키워드를 돌려주지 않았습니다. 씨앗을 바꿔 보세요.", 422);
  const result = await generateProposal({ ownerId: account.ownerId, kind: data.kind, caps: accountCaps, seeds, stats }, llm);
  const row = await prisma.adProposal.create({
    data: {
      ownerId: account.ownerId, adAccountId: account.id, kind: data.kind, targetAdgroupId: data.targetAdgroupId ?? null,
      status: "pending_review",
      payload: result.payload as unknown as Prisma.InputJsonValue,
      lintResult: lintResultOf(result.lintIssues) as unknown as Prisma.InputJsonValue,
      sourceKeywords: result.sourceKeywords as unknown as Prisma.InputJsonValue,
      costKrw: result.costKrw,
    },
    select: PROPOSAL_SELECT,
  });
  return toProposalDTO(row);
}

export async function getProposal(ownerId: string, id: string): Promise<AdProposalDTO> {
  assertAdsOwner(ownerId);
  if (!isEntityId(id)) throw notFound();
  const row = await prisma.adProposal.findFirst({ where: { id, ownerId }, select: PROPOSAL_SELECT });
  if (!row) throw notFound();
  return toProposalDTO(row);
}

/** 최신순(createdAt desc, id desc) 키셋 페이지. 커서는 내 제안 id여야 한다(남의 id·없는 id는 400). */
export async function listProposals(ownerId: string, input: Partial<AdsProposalListInput>): Promise<AdProposalPage> {
  assertAdsOwner(ownerId);
  const q = adsProposalListSchema.parse(input);
  const where: Prisma.AdProposalWhereInput = { ownerId, ...(q.status ? { status: q.status } : {}), ...(q.accountId ? { adAccountId: q.accountId } : {}) };
  if (q.cursor) {
    const at = await prisma.adProposal.findFirst({ where: { id: q.cursor, ownerId }, select: { id: true, createdAt: true } });
    if (!at) throw new AdsHttpError("bad_cursor", "목록 위치가 올바르지 않습니다. 처음부터 다시 불러오세요.", 400);
    where.OR = [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }];
  }
  const rows = await prisma.adProposal.findMany({ where, select: PROPOSAL_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: q.take + 1 });
  const page = rows.slice(0, q.take);
  return { items: page.map(toSummary), nextCursor: rows.length > q.take ? page[page.length - 1].id : null };
}
