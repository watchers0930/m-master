// lib/ads/proposal-review.ts — 제안 편집·승인·반려 상태기계(lib/content/review.ts와 같은 잠금 + CAS + 감사로그).
// 허용 전이: pending_review → approved | rejected. 편집은 pending_review에서만(4-1에서는 승인·반려된 제안을 다시 편집하지 않는다).
// 순서(트랜잭션 하나): SELECT … FOR UPDATE(id AND owner_id) → 행 재조회(없으면 404) → expected_updated_at CAS(아니면 409 version_conflict,
//   최신 updated_at 동봉) → 전이 검사(409 invalid_transition) → 검증 → updateMany(id, ownerId, updatedAt, status) count=1 확인 → 감사로그.
// - 편집: 계정 상한으로 입찰을 다시 검사(invariants.checkBid — 범위 밖은 422 ads_invariant + field), 개수 검사, 근거는 통계로 덮어쓰고,
//   린트를 다시 돌려 lintResult를 바꾼다. 남은 위반은 저장되지만 승인을 막는다.
// - 승인: 같은 잠금 안에서 저장된 payload의 입찰(현재 계정 상한)과 린트를 다시 계산한다. 위반 1건이라도 있으면 409 lint_issues_remain.
//   승인은 네이버를 부르지 않는다(적용은 Task 9).
// - 같은 결정의 반복(이미 approved에 approve)은 content와 같이 변경 없이 현재 상태를 돌려준다(changed=false).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adsProposalEditSchema, adsProposalReviewSchema, type AdsProposalEditInput, type AdsProposalReviewInput } from "@/schemas/ads-proposal";
import { isEntityId } from "@/schemas/id";
import type { AdProposalDTO } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { notFound } from "./account-core";
import { AdsHttpError } from "./http";
import { AdsInvariantError, caps } from "./invariants";
import { checkPayload, lintPayload, type Problem } from "./proposal-check";
import { kindOf, lintResultOf, payloadOf, PROPOSAL_SELECT, sourceKeywordsOf, toProposalDTO } from "./proposals";

type Tx = Prisma.TransactionClient;
const CONFLICT_MESSAGE: Readonly<Record<string, string>> = {
  version_conflict: "다른 곳에서 제안이 바뀌었습니다. 최신 내용을 확인하세요.",
  invalid_transition: "지금 상태에서는 할 수 없는 작업입니다.",
  lint_issues_remain: "등록 기준 위반이 남아 있어 승인할 수 없습니다. 위반을 고친 뒤 승인하세요.",
};

export function proposalConflict(code: keyof typeof CONFLICT_MESSAGE, updatedAt?: Date, extra: Record<string, number> = {}): never {
  throw new AdsHttpError(code, CONFLICT_MESSAGE[code], 409, { ...(updatedAt ? { updated_at: updatedAt.toISOString() } : {}), ...extra });
}

/** 모든 편집·결정은 이 행 잠금을 먼저 잡고 상태를 읽는다. */
async function lockProposal(tx: Tx, ownerId: string, id: string) {
  if (!isEntityId(id)) throw notFound();
  await tx.$queryRaw`SELECT id FROM ad_proposals WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`;
  const row = await tx.adProposal.findFirst({ where: { id, ownerId } });
  if (!row) throw notFound();
  return row;
}

const nextVersion = (previous: Date) => new Date(Math.max(Date.now(), previous.getTime() + 1));

async function accountCaps(tx: Tx, ownerId: string, accountId: string) {
  const account = await tx.adAccount.findFirst({ where: { id: accountId, ownerId }, select: { dailyCapKrw: true, sharedBudgetKrw: true, maxBidKrw: true } });
  if (!account) throw notFound();
  return caps(account); // 계정 상한값이 깨져 있으면 AdsInvariantError(422) — 상한이 풀린 채로 저장·승인하지 않는다
}

function problemError(p: Problem): Error {
  if (p.rule === "bid-range") return new AdsInvariantError(p.path);
  return new AdsHttpError("proposal_invalid", p.message, 422, { field: p.path });
}

async function audit(tx: Tx, ownerId: string, id: string, action: string, payload: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { actor: ownerId, targetType: "ad_proposal", targetId: id, action, payload } });
}

const readBack = async (tx: Tx, ownerId: string, id: string) =>
  toProposalDTO(await tx.adProposal.findFirstOrThrow({ where: { id, ownerId }, select: PROPOSAL_SELECT }));

export async function editProposal(ownerId: string, id: string, input: AdsProposalEditInput): Promise<AdProposalDTO> {
  assertAdsOwner(ownerId);
  const data = adsProposalEditSchema.parse(input);
  const expected = Date.parse(data.expected_updated_at);
  return prisma.$transaction(async (tx) => {
    const row = await lockProposal(tx, ownerId, id);
    if (row.updatedAt.getTime() !== expected) proposalConflict("version_conflict", row.updatedAt);
    if (row.status !== "pending_review") proposalConflict("invalid_transition");
    const checked = checkPayload(data.payload, {
      kind: kindOf(row), caps: await accountCaps(tx, ownerId, row.adAccountId), stats: sourceKeywordsOf(row), source: "edit",
    });
    if (checked.problems.length) throw problemError(checked.problems[0]);
    const issues = lintPayload(checked.payload);
    const { count } = await tx.adProposal.updateMany({
      where: { id, ownerId, updatedAt: row.updatedAt, status: "pending_review" },
      data: {
        payload: checked.payload as unknown as Prisma.InputJsonValue,
        lintResult: lintResultOf(issues) as unknown as Prisma.InputJsonValue,
        updatedAt: nextVersion(row.updatedAt),
      },
    });
    if (count !== 1) proposalConflict("version_conflict");
    await audit(tx, ownerId, id, "ads.proposal_edit", { lintIssueCount: issues.length });
    return readBack(tx, ownerId, id);
  });
}

export async function reviewProposal(ownerId: string, id: string, input: AdsProposalReviewInput): Promise<AdProposalDTO & { changed: boolean }> {
  assertAdsOwner(ownerId);
  const data = adsProposalReviewSchema.parse(input);
  const target = data.decision === "approve" ? "approved" : "rejected";
  return prisma.$transaction(async (tx) => {
    const row = await lockProposal(tx, ownerId, id);
    if (row.status === target) return { ...(await readBack(tx, ownerId, id)), changed: false };
    if (row.updatedAt.getTime() !== Date.parse(data.expected_updated_at)) proposalConflict("version_conflict", row.updatedAt);
    if (row.status !== "pending_review") proposalConflict("invalid_transition");
    if (data.decision === "approve") {
      const payload = payloadOf(row);
      const checked = checkPayload(payload, {
        kind: kindOf(row), caps: await accountCaps(tx, ownerId, row.adAccountId), stats: sourceKeywordsOf(row), source: "edit",
      });
      if (checked.problems.length) throw problemError(checked.problems[0]);
      const remaining = lintPayload(payload).length;
      if (remaining > 0) proposalConflict("lint_issues_remain", undefined, { lintIssueCount: remaining });
    }
    const { count } = await tx.adProposal.updateMany({
      where: { id, ownerId, updatedAt: row.updatedAt, status: "pending_review" },
      data: { status: target, reviewedAt: new Date(), reviewedBy: ownerId, updatedAt: nextVersion(row.updatedAt) },
    });
    if (count !== 1) proposalConflict("version_conflict");
    await audit(tx, ownerId, id, `ads.proposal_${data.decision}`, { reason: data.reason ?? null });
    return { ...(await readBack(tx, ownerId, id)), changed: true };
  });
}
