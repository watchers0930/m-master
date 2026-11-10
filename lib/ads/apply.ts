// lib/ads/apply.ts — 승인된 제안을 네이버에 적용한다(설계서 §5.5-6). 단계 구현은 apply-steps.ts, 대조 조회는 reconcile.ts.
// 상태 전이: approved | apply_failed → applying → applied | apply_failed. 그 밖은 409 invalid_transition.
// 점유(claim, 트랜잭션 하나): SELECT … FOR UPDATE(id AND owner_id) → 재조회 → 전이 검사 → 계정 준비·상한·입찰·린트 재검증(설계서 §5.4-3:
//   승인 때 검사를 믿지 않는다) → extend_group 대상 그룹 소유 확인 → updateMany(id, ownerId, status, updatedAt) count=1 → applying.
//   updatedAt = 점유 토큰. 단계마다 토큰을 갱신(heartbeat, 같은 조건부 updateMany)하고, 토큰을 잃으면(다른 실행이 회수) 즉시 멈춘다.
// 멈춘 applying(프로세스 사망) 회수: 토큰이 STALE_APPLY_MS(10분)보다 오래됐으면 새 적용이 점유한다(Task 5 해제와 같은 방식).
//   근거: 단계 1개 = POST 1회 + GET 몇 회(각 시도 25초·전체 45초 상한)라 정상 실행은 단계마다 토큰을 몇 분 안에 갱신한다.
//   라우트 maxDuration(300초) < 10분이라 살아 있는 실행이 회수당하지 않는다. 젊은 applying은 409 apply_in_progress.
// 실행 순서: 캠페인 → 모든 그룹 → 모든 키워드 → 모든 소재(new_campaign). extend_group은 대상 그룹(소유·미러·삭제 아님 확인)에
//   키워드·소재만 붙이고 그룹 이름·입찰은 쓰지 않는다. 소재 slot은 그 그룹의 기존(다른 제안·외부) 최대 slot + 1부터.
// 쓰기마다 비상 정지 스위치·계정 active를 보내기 직전에 확인한다(execution.ts). 실패는 apply_failed + failCode(apply-errors.ts)로 남기고
// 같은 제안을 다시 적용하면 이어서 진행한다(중복 생성 없음 — apply-steps.ts 머리말). 모르는 오류는 internal_error로 기록하고 다시 던진다.
import type { AdAccount, AdProposal, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isEntityId } from "@/schemas/id";
import type { ProposalPayload } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { notFound, withAccountClient, type AdsDeps } from "./account-core";
import { ApplyFailure, failCodeOf } from "./apply-errors";
import { checkTarget, stepAd, stepAdgroup, stepCampaign, stepKeyword, type ApplyCtx, type PriorOp } from "./apply-steps";
import { assertExecutionEnabled } from "./execution";
import { AdsHttpError } from "./http";
import { AdsInvariantError, caps } from "./invariants";
import { checkPayload, lintPayload } from "./proposal-check";
import { proposalConflict } from "./proposal-review";
import { kindOf, payloadOf, sourceKeywordsOf } from "./proposals";

type Tx = Prisma.TransactionClient;
export const STALE_APPLY_MS = 10 * 60_000;
/** 테스트 전용 이음새: 잠금·재조회 직후 같은 트랜잭션에서 실행된다(기본 no-op). 라우트는 이 인자를 넘기지 않는다. */
export type ApplyDeps = AdsDeps & { afterLock?: (tx: Tx, row: AdProposal) => Promise<void> };
export type ApplyResult = { status: "applied" | "apply_failed"; failCode?: string };

const conflict = (code: "apply_in_progress" | "apply_conflict") =>
  new AdsHttpError(code, code === "apply_in_progress" ? "이미 적용이 진행 중입니다. 잠시 후 결과를 확인하세요." : "다른 곳에서 제안 상태가 바뀌었습니다. 최신 상태를 확인하세요.", 409);
const notReady = () => new AdsHttpError("ads_account_not_ready", "광고 계정이 활성 상태이고 공유예산·비즈채널이 있어야 적용할 수 있습니다.", 409);
class LostClaim extends Error {}
const nextToken = (previous: Date, now: () => Date) => new Date(Math.max(now().getTime(), previous.getTime() + 1));

/** 승인 때와 같은 규칙을 현재 계정 상한으로 다시 검사한다(입찰 범위 → 422 ads_invariant, 남은 린트 → 409). */
function recheck(row: AdProposal, account: AdAccount): void {
  if (account.status !== "active" || !account.sharedBudgetId || !account.businessChannelId) throw notReady();
  const payload = payloadOf(row);
  const checked = checkPayload(payload, { kind: kindOf(row), caps: caps(account), stats: sourceKeywordsOf(row), source: "edit" });
  const problem = checked.problems[0];
  if (problem) throw problem.rule === "bid-range" ? new AdsInvariantError(problem.path) : new AdsHttpError("proposal_invalid", problem.message, 422, { field: problem.path });
  const remaining = lintPayload(payload).length;
  if (remaining > 0) proposalConflict("lint_issues_remain", undefined, { lintIssueCount: remaining });
}

async function claim(ownerId: string, id: string, now: () => Date, deps: ApplyDeps) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ad_proposals WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`;
    const row = await tx.adProposal.findFirst({ where: { id, ownerId } });
    if (!row) throw notFound();
    await deps.afterLock?.(tx, row);
    const stale = row.status === "applying" && row.updatedAt.getTime() < now().getTime() - STALE_APPLY_MS;
    if (row.status === "applying" && !stale) throw conflict("apply_in_progress");
    if (!stale && row.status !== "approved" && row.status !== "apply_failed") proposalConflict("invalid_transition");
    const account = await tx.adAccount.findFirst({ where: { id: row.adAccountId, ownerId } });
    if (!account) throw notFound();
    recheck(row, account);
    if (kindOf(row) === "extend_group") {
      const target = row.targetAdgroupId
        ? await tx.adGroup.findFirst({ where: { ownerId, adAccountId: account.id, naverId: row.targetAdgroupId }, select: { id: true } }) : null;
      if (!target) throw new AdsHttpError("target_adgroup_missing", "확장할 광고그룹을 이 계정의 MINTEQ 기록에서 찾지 못했습니다.", 409);
    }
    const token = nextToken(row.updatedAt, now);
    const { count } = await tx.adProposal.updateMany({
      where: { id, ownerId, status: row.status, updatedAt: row.updatedAt }, data: { status: "applying", failCode: null, updatedAt: token },
    });
    if (count !== 1) throw conflict("apply_conflict");
    return { row, account, token };
  });
}

/** 이 제안이 보낸 생성 POST의 단계별 최신 원장 행(재개 판단용). */
async function priorOps(proposalId: string): Promise<Map<string, PriorOp>> {
  const rows = await prisma.adOperationLog.findMany({
    where: { proposalId, method: "POST" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { step: true, status: true, naverId: true, createdAt: true },
  });
  return new Map(rows.map((r) => [r.step, { status: r.status, naverId: r.naverId, createdAt: r.createdAt }]));
}

/** extend_group: 대상 그룹의 기존 slot(이 제안 것 제외) 최대값. 재개해도 같은 번호가 나온다. */
async function slotBase(account: AdAccount, groupId: string, proposalId: string): Promise<number> {
  const rows = await prisma.adCreative.findMany({
    where: { adAccountId: account.id, parentNaverId: groupId, OR: [{ proposalId: null }, { proposalId: { not: proposalId } }] }, select: { slot: true },
  });
  return rows.reduce((max, r) => Math.max(max, Number(/^a(\d+)$/.exec(r.slot ?? "")?.[1] ?? 0)), 0);
}

async function run(ctx: ApplyCtx, row: AdProposal, payload: ProposalPayload): Promise<void> {
  if (kindOf(row) === "extend_group") {
    const groupId = row.targetAdgroupId as string, g = payload.groups[0];
    await checkTarget(ctx, groupId);
    for (const [i, k] of g.keywords.entries()) await stepKeyword(ctx, groupId, "g1", i, k);
    const start = await slotBase(ctx.account, groupId, row.id);
    for (const [i, c] of g.creatives.entries()) await stepAd(ctx, groupId, "g1", `a${start + i + 1}`, c, `mq-${row.id}-x-a${start + i + 1}`);
    return;
  }
  const campaignId = await stepCampaign(ctx);
  const groupIds: string[] = [];
  for (const [i, g] of payload.groups.entries()) groupIds.push(await stepAdgroup(ctx, campaignId, i + 1, g.bidAmt));
  for (const [gi, g] of payload.groups.entries())
    for (const [i, k] of g.keywords.entries()) await stepKeyword(ctx, groupIds[gi], `g${gi + 1}`, i, k);
  for (const [gi, g] of payload.groups.entries())
    for (const [i, c] of g.creatives.entries()) await stepAd(ctx, groupIds[gi], `g${gi + 1}`, `a${i + 1}`, c, `mq-${row.id}-g${gi + 1}-a${i + 1}`);
}

export async function applyProposal(ownerId: string, id: string, deps: ApplyDeps = {}): Promise<ApplyResult> {
  assertAdsOwner(ownerId);
  if (!isEntityId(id)) throw notFound();
  if (deps.afterLock && process.env.NODE_ENV === "production") throw new Error("test_seam_forbidden"); // 이음새는 테스트 전용
  assertExecutionEnabled(); // 꺼져 있으면 점유도 하지 않는다(상태 그대로, 네이버 호출 0)
  const now = deps.now ?? (() => new Date());
  const claimed = await claim(ownerId, id, now, deps);
  let token = claimed.token;
  const where = () => ({ id, ownerId, status: "applying", updatedAt: token });
  const heartbeat = async () => {
    const next = nextToken(token, now);
    const { count } = await prisma.adProposal.updateMany({ where: where(), data: { updatedAt: next } });
    if (count !== 1) throw new LostClaim();
    token = next;
  };
  const finish = async (status: ApplyResult["status"], failCode: string | null) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.adProposal.updateMany({
        where: where(), data: { status, failCode, updatedAt: nextToken(token, now), ...(status === "applied" ? { appliedAt: now() } : {}) },
      });
      if (count !== 1) throw conflict("apply_conflict");
      await tx.auditLog.create({ data: { actor: ownerId, targetType: "ad_proposal", targetId: id, action: "ads.proposal_apply", payload: { status, failCode } } });
    });
  // ctx.step은 단계마다 바뀐다(실패 코드 uncertain:<step>에 쓴다).
  const prior = await priorOps(id);
  let ctx: ApplyCtx | undefined;
  try {
    await withAccountClient(claimed.account, deps, (client) => {
      ctx = { client, account: claimed.account, proposalId: id, prior, now, heartbeat, step: "start" };
      return run(ctx, claimed.row, payloadOf(claimed.row));
    });
  } catch (error) {
    if (error instanceof LostClaim) throw conflict("apply_conflict"); // 다른 실행이 회수했다 — 그쪽이 결과를 기록한다
    const failCode = failCodeOf(error, ctx?.step ?? "start");
    await finish("apply_failed", failCode ?? "internal_error");
    if (failCode === null) throw error;
    if (!(error instanceof ApplyFailure)) console.error("[ads] apply failed", { proposalId: id, failCode });
    return { status: "apply_failed", failCode };
  }
  await finish("applied", null);
  return { status: "applied" };
}
