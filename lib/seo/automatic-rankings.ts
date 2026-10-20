import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwner } from "@/lib/visibility/queries";
import { notFound, VisibilityError } from "@/lib/visibility/http";
import { checkSeoFeature } from "@/lib/billing/limits";
import { checkSeoBudget } from "./budget";
import { rankPlans, taskData, type Config } from "./plan";
import { releaseKeywordReservations } from "./reservations";

/**
 * 전체 진단의 연구(키워드) 태스크가 끝나면, 상위 키워드로 순위(SERP) 태스크를 1회 예약한다.
 * 예약만 하고 제출(task_post)은 다음 resume에서 이뤄진다. 예산/정책 거절은 미완료로 기록한다.
 */
export async function scheduleAutomaticRankings(ownerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const plan = await lockOwner(tx, ownerId);
    const audit = await tx.seoAudit.findFirst({
      where: { id, domain: { ownerId } },
    });
    if (!audit) notFound();
    const config = audit.frozenConfig as unknown as Config;
    if (!config.autoRankings) return;
    const research = await tx.seoTask.count({
      where: {
        auditId: id,
        operation: { in: ["labs_ranked", "keywords_for_site"] },
        status: { in: ["pending", "claimed", "submitted"] },
      },
    });
    if (research) return;
    try {
      checkSeoFeature(plan);
      const candidates = await tx.seoKeyword.findMany({
        where: {
          domainId: audit.domainId,
          market: audit.market,
          engine: "google",
          lastAuditId: id,
        },
        select: { id: true },
        orderBy: [{ searchVolume: "desc" }, { id: "asc" }],
        take: Math.floor(10 / config.engines.length),
      });
      const frozen = {
        ...config,
        autoRankings: false,
        autoRankingsState: "scheduled" as const,
        keywordIds: candidates.map((k) => k.id),
      };
      const tasks = await rankPlans(tx, ownerId, frozen, plan, true);
      await checkSeoBudget(
        tx,
        ownerId,
        plan,
        tasks.reduce((n, t) => n + t.reservedKrw, 0),
      );
      if (tasks.length)
        await tx.seoTask.createMany({
          data: tasks.map((t) => ({
            ...taskData(t, ownerId, audit.runKey),
            auditId: id,
          })),
          skipDuplicates: true,
        });
      await tx.seoAudit.update({
        where: { id },
        data: { frozenConfig: frozen as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      // Policy/budget refusals are genuine incomplete work, not unsupported skips.
      // Database failures still abort, so no failed transaction is used for further writes.
      if (!(error instanceof VisibilityError)) throw error;
      await tx.seoTask.createMany({
        data: [
          {
            auditId: id,
            ownerId,
            runKey: audit.runKey,
            operation: "automatic_rankings",
            itemKey: "-",
            frozenInput: {},
            status: "failed",
            reservedKrw: 0,
            failReason: "예산 또는 실행 조건으로 자동 순위 수집을 생략했습니다.",
          },
        ],
        skipDuplicates: true,
      });
      await tx.seoAudit.update({
        where: { id },
        data: {
          frozenConfig: {
            ...config,
            autoRankings: false,
            autoRankingsState: "skipped",
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await releaseKeywordReservations(tx, audit.domainId);
    }
  });
}
