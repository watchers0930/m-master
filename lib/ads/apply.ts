// lib/ads/apply.ts — 승인된 제안을 네이버에 적용한다(설계서 §5.5-6). 단계 구현은 apply-steps.ts, 대조 조회는 reconcile.ts.
// 상태 전이: approved | apply_failed → applying → applied | apply_failed. 그 밖은 409 invalid_transition.
// 점유(claim, 트랜잭션 하나): SELECT … FOR UPDATE(id AND owner_id) → 재조회 → 전이 검사 → 계정 행 FOR UPDATE → 계정 준비·상한·입찰·린트 재검증(설계서 §5.4-3:
//   승인 때 검사를 믿지 않는다) → extend_group 대상 그룹 소유 확인 → updateMany(id, ownerId, status, updatedAt) count=1 → applying.
//   공유예산 없는 계정의 new_campaign은 같은 계정에 살아 있는 applying이 있으면 409 apply_in_progress(mq-cap 생성 단일화, 핫픽스 2026-11-11).
//   updatedAt = 점유 토큰. 단계마다 토큰을 갱신(heartbeat, 같은 조건부 updateMany)하고, 토큰을 잃으면(다른 실행이 회수) 즉시 멈춘다.
// 멈춘 applying(프로세스 사망) 회수: 토큰이 STALE_APPLY_MS(10분)보다 오래됐으면 새 적용이 점유한다(Task 5 해제와 같은 방식).
//   근거: 단계 1개 = POST 1회 + GET 몇 회(각 시도 25초·전체 45초 상한)라 정상 실행은 단계마다 토큰을 몇 분 안에 갱신한다.
//   라우트 maxDuration(300초) < 10분이라 살아 있는 실행이 회수당하지 않는다. 젊은 applying은 409 apply_in_progress.
// 실행 순서: (재개면) 끄기 실패로 켜진 채 남은 이 제안 엔티티를 먼저 끈다 → 캠페인 → 모든 그룹 → 모든 키워드 → 모든 소재(new_campaign).
//   extend_group은 대상 그룹(소유·미러·삭제 아님, 그룹·캠페인이 네이버에서 꺼짐 — 아니면 점유 전 409 target_active)에 키워드·소재만 붙이고
//   그룹 이름·입찰은 쓰지 않는다. 소재 slot은 첫 시도에 그 그룹의 미러·원장 예약 최대값 + 1로 정하고, 재개는 그 값을 다시 쓴다.
// 판매 금지 키워드(실운영 2026-11-12): 쓰기 전에 제안 키워드 전체를 GET /ncc/managedKeyword로 한 번 조회한다(실패면 그대로 던져 POST 0으로 멈춤).
//   판매 금지는 원장을 보기 전에 stepProhibitedKeyword(이미 만들어진 것만 이어 쓰고 없으면 건너뜀)로 보낸다. 건너뛴 키워드는 감사 로그·결과에 남긴다.
// 쓰기마다 비상 정지 스위치·계정 active를 보내기 직전에 확인한다(execution.ts). 실패는 apply_failed + failCode(apply-errors.ts)로 남기고
// 같은 제안을 다시 적용하면 이어서 진행한다(중복 생성 없음 — apply-steps.ts 머리말). 모르는 오류는 internal_error로 기록하고 다시 던진다.
import type { AdAccount, AdProposal, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isEntityId } from "@/schemas/id";
import type { AdApplyResultDTO, ProposalKeyword, ProposalPayload } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { notFound, withAccountClient, type AdsDeps } from "./account-core";
import { ATTACH_STEP } from "./apply-budget";
import { ApplyFailure, failCodeOf } from "./apply-errors";
import { checkTarget, retryPendingPauses, targetIsPaused } from "./apply-inspect";
import { stepAd, stepAdgroup, stepCampaign, stepKeyword, stepProhibitedKeyword, type ApplyCtx, type PriorOp } from "./apply-steps";
import { assertExecutionEnabled } from "./execution";
import { AdsHttpError } from "./http";
import { caps } from "./invariants";
import { keywordDedupeKey } from "./keyword-text";
import { sellProhibitedKeywords } from "./managed-keywords";
import { checkPayload, lintPayload } from "./proposal-check";
import { problemError, proposalConflict } from "./proposal-review";
import { kindOf, payloadOf, sourceKeywordsOf } from "./proposals";

type Tx = Prisma.TransactionClient;
export const STALE_APPLY_MS = 10 * 60_000;
/** 테스트 전용 이음새: 잠금·재조회 직후 같은 트랜잭션에서 실행된다(기본 no-op). 라우트는 이 인자를 넘기지 않는다. */
export type ApplyDeps = AdsDeps & { afterLock?: (tx: Tx, row: AdProposal) => Promise<void> };
export type ApplyResult = AdApplyResultDTO; // 응답 DTO(types/ads.ts) — 화면과 같은 타입

const conflict = (code: "apply_in_progress" | "apply_conflict") =>
  new AdsHttpError(code, code === "apply_in_progress" ? "이미 적용이 진행 중입니다. 잠시 후 결과를 확인하세요." : "다른 곳에서 제안 상태가 바뀌었습니다. 최신 상태를 확인하세요.", 409);
const notReady = () => new AdsHttpError("ads_account_not_ready", "광고 계정이 활성 상태이고 비즈채널이 선택돼 있어야 적용할 수 있습니다.", 409);
class LostClaim extends Error {}
const nextToken = (previous: Date, now: () => Date) => new Date(Math.max(now().getTime(), previous.getTime() + 1));

/** 승인 때와 같은 규칙을 현재 계정 상한으로 다시 검사한다(입찰 범위 → 422 ads_invariant, 남은 린트 → 409). */
function recheck(row: AdProposal, account: AdAccount): void {
  if (account.status !== "active" || !account.businessChannelId) throw notReady(); // 공유예산은 첫 적용이 만든다(apply-budget.ts)
  const payload = payloadOf(row);
  const checked = checkPayload(payload, { kind: kindOf(row), caps: caps(account), stats: sourceKeywordsOf(row), source: "edit" });
  const problem = checked.problems[0];
  if (problem) throw problemError(problem);
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
    // 계정 행도 잠근다(제안 → 계정 순서 고정). 공유예산 없는 계정의 new_campaign은 한 번에 하나만 — 두 적용이 mq-cap을 둘 만들지 않게
    await tx.$queryRaw`SELECT id FROM ad_accounts WHERE id = ${row.adAccountId} AND owner_id = ${ownerId} FOR UPDATE`;
    const account = await tx.adAccount.findFirst({ where: { id: row.adAccountId, ownerId } });
    if (!account) throw notFound();
    recheck(row, account);
    if (!account.sharedBudgetId && kindOf(row) === "new_campaign") {
      const live = { gte: new Date(now().getTime() - STALE_APPLY_MS) };
      if (await tx.adProposal.count({ where: { ownerId, adAccountId: account.id, status: "applying", updatedAt: live, NOT: { id } } })) throw conflict("apply_in_progress");
    }
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

/** 이 제안이 보낸 생성 POST(+ 공유예산 붙이기 PUT)의 단계별 최신 원장 행(재개 판단용). 소재 step은 '<식별자>#<그룹 id>:<slot>' — 첫 시도의 slot을 복원한다. */
async function priorOps(proposalId: string): Promise<Map<string, PriorOp>> {
  const rows = await prisma.adOperationLog.findMany({
    where: { proposalId, OR: [{ method: "POST" }, { method: "PUT", step: ATTACH_STEP }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { step: true, status: true, naverId: true, createdAt: true },
  });
  return new Map(rows.map((r) => {
    const [identity, reserved] = r.step.split("#");
    return [identity, { status: r.status, naverId: r.naverId, createdAt: r.createdAt, slot: reserved?.split(":").pop() }];
  }));
}

const slotNo = (slot: string | null | undefined) => Number(/^a(\d+)$/.exec(slot ?? "")?.[1] ?? 0);

/** extend_group 새 소재 slot: 그 그룹의 미러 slot과 원장 예약(모든 제안의 소재 POST step 접미사) 중 최대 + 1. 첫 시도에서만 부른다. */
async function nextSlot(account: AdAccount, groupId: string): Promise<string> {
  const [mirrors, reserved] = await Promise.all([
    prisma.adCreative.findMany({ where: { adAccountId: account.id, parentNaverId: groupId }, select: { slot: true } }),
    prisma.adOperationLog.findMany({ where: { adAccountId: account.id, method: "POST", step: { contains: `#${groupId}:` } }, select: { step: true } }),
  ]);
  const max = Math.max(0, ...mirrors.map((m) => slotNo(m.slot)), ...reserved.map((r) => slotNo(r.step.split(":").pop())));
  return `a${max + 1}`;
}

async function run(ctx: ApplyCtx, row: AdProposal, payload: ProposalPayload, skipped: string[]): Promise<void> {
  await retryPendingPauses(ctx);
  ctx.step = "managed_keywords";
  const prohibited = await sellProhibitedKeywords(ctx.client, payload.groups.flatMap((g) => g.keywords.map((k) => k.keyword)));
  const keyword = async (groupId: string, label: string, i: number, k: ProposalKeyword) => {
    if (!prohibited.has(keywordDedupeKey(k.keyword))) return stepKeyword(ctx, groupId, label, i, k);
    if (!(await stepProhibitedKeyword(ctx, groupId, label, i, k))) skipped.push(k.keyword);
  };
  if (kindOf(row) === "extend_group") {
    const groupId = row.targetAdgroupId as string, g = payload.groups[0];
    await checkTarget(ctx, groupId);
    for (const [i, k] of g.keywords.entries()) await keyword(groupId, "g1", i, k);
    for (const [i, c] of g.creatives.entries()) await stepAd(ctx, groupId, "g1", i, c, () => nextSlot(ctx.account, groupId));
    return;
  }
  const campaignId = await stepCampaign(ctx);
  const groupIds: string[] = [];
  for (const [i, g] of payload.groups.entries()) groupIds.push(await stepAdgroup(ctx, campaignId, i + 1, g.bidAmt));
  for (const [gi, g] of payload.groups.entries())
    for (const [i, k] of g.keywords.entries()) await keyword(groupIds[gi], `g${gi + 1}`, i, k);
  for (const [gi, g] of payload.groups.entries())
    for (const [i, c] of g.creatives.entries()) await stepAd(ctx, groupIds[gi], `g${gi + 1}`, i, c, async () => `a${i + 1}`);
}

/** 점유 전: extend_group 대상 그룹·캠페인이 네이버에서 켜져 있으면 409 target_active(상태 그대로, 쓰기 0). 판정할 수 없는 경우는 점유가 다룬다. */
async function assertTargetPaused(ownerId: string, id: string, deps: ApplyDeps): Promise<void> {
  const row = isEntityId(id) ? await prisma.adProposal.findFirst({ where: { id, ownerId }, select: { kind: true, targetAdgroupId: true, adAccountId: true } }) : null;
  if (!row || kindOf(row) !== "extend_group" || !row.targetAdgroupId) return;
  const account = await prisma.adAccount.findFirst({ where: { id: row.adAccountId, ownerId } });
  const target = account && await prisma.adGroup.findFirst({ where: { ownerId, adAccountId: account.id, naverId: row.targetAdgroupId }, select: { id: true } });
  if (!account || account.status !== "active" || !target) return;
  // 끄기 실패로 켜진 채 남은 이 제안 엔티티가 있으면 여기서 막지 않는다 — 점유 뒤 run이 그 끄기부터 재시도한다(판정 round 2 d)
  const pending = { where: { proposalId: id, adAccountId: account.id, userLock: false } };
  const counts = await Promise.all([prisma.adCampaign.count(pending), prisma.adGroup.count(pending), prisma.adKeyword.count(pending), prisma.adCreative.count(pending)]);
  if (counts.some((n) => n > 0)) return;
  const groupId = row.targetAdgroupId;
  if (!(await withAccountClient(account, deps, (client) => targetIsPaused(client, groupId))))
    throw new AdsHttpError("target_active", "확장할 광고그룹이나 그 캠페인이 켜져 있습니다. 네이버에서 먼저 끈 뒤 적용하세요(새 소재가 바로 노출되지 않게).", 409);
}

export async function applyProposal(ownerId: string, id: string, deps: ApplyDeps = {}): Promise<ApplyResult> {
  assertAdsOwner(ownerId);
  if (!isEntityId(id)) throw notFound();
  if (deps.afterLock && process.env.NODE_ENV === "production") throw new Error("test_seam_forbidden"); // 이음새는 테스트 전용
  assertExecutionEnabled(); // 꺼져 있으면 점유도 하지 않는다(상태 그대로, 네이버 호출 0)
  const now = deps.now ?? (() => new Date());
  await assertTargetPaused(ownerId, id, deps);
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
      const audit = skipped.length ? { status, failCode, skippedKeywords: skipped } : { status, failCode };
      await tx.auditLog.create({ data: { actor: ownerId, targetType: "ad_proposal", targetId: id, action: "ads.proposal_apply", payload: audit } });
    });
  // ctx.step은 단계마다 바뀐다(실패 코드 uncertain:<step>에 쓴다).
  const prior = await priorOps(id);
  const skipped: string[] = [];
  let ctx: ApplyCtx | undefined;
  try {
    await withAccountClient(claimed.account, deps, (client) => {
      ctx = { client, account: claimed.account, proposalId: id, prior, now, heartbeat, step: "start" };
      return run(ctx, claimed.row, payloadOf(claimed.row), skipped);
    });
  } catch (error) {
    if (error instanceof LostClaim) throw conflict("apply_conflict"); // 다른 실행이 회수했다 — 그쪽이 결과를 기록한다
    const failCode = failCodeOf(error, ctx?.step ?? "start");
    await finish("apply_failed", failCode ?? "internal_error");
    if (failCode === null) throw error;
    if (!(error instanceof ApplyFailure)) console.error("[ads] apply failed", { proposalId: id, failCode });
    return { status: "apply_failed", failCode, ...(skipped.length ? { skippedKeywords: skipped } : {}) };
  }
  await finish("applied", null);
  return skipped.length ? { status: "applied", skippedKeywords: skipped } : { status: "applied" };
}
