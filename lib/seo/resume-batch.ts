import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processAudit } from "./audit";
import { ABANDONED_AUDIT_MS, abandonedAuditTasks } from "./reservations";

const ACTIVE = ["pending", "claimed", "submitted"] as const;
const SETTLED = ["completed", "partial", "failed", "skipped", "uncertain"] as const;
// maxDuration(300s) 아래 30s 여유를 남기는 배치 종료 천장.
const HARD_CEILING_MS = 270_000;
// 한 패스 최악 소요(2건 polling ~45s + 건당 결과저장 ~20s 직렬화)의 보수적 여유.
// ⚠️ 절대 보장은 아니다(하위 호출에 deadline 미전파) — 초과 시 Vercel이 종료하나 각 태스크는
//    트랜잭션 커밋돼 유실 없고, 미마감 감사는 다음 실행이 복구한다.
const PASS_BUDGET_MS = 90_000;

/** 이미 제출돼(vendorTaskId 존재) 과금 없이 수거 가능한, 리스 만료된 태스크 수. */
function collectableCount(auditId: string) {
  return prisma.seoTask.count({
    where: {
      auditId,
      status: { in: [...ACTIVE] },
      AND: [{ OR: [{ vendorTaskId: { not: null } }, { resultCheckpoint: { not: Prisma.DbNull } }] }],
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
  });
}

/** 활성(미종결) 태스크 수 — 0이면 마감(synthesize)만 남은 상태. */
function activeCount(auditId: string) {
  return prisma.seoTask.count({
    where: { auditId, status: { in: [...ACTIVE] } },
  });
}

/** 종결된 태스크 수 — 패스 간 수거 진행 여부 판정용. */
function settledCount(auditId: string) {
  return prisma.seoTask.count({
    where: { auditId, status: { in: [...SETTLED] } },
  });
}

/**
 * 진행 중(pending)인 감사의 **이미 제출된** DataForSEO 태스크 결과만 배치 수거한다.
 * 온디맨드 resume과 동일한 processAudit(collectOnly)을 재사용 → 2건 동시·소유자락·예산가드 그대로.
 *
 * - collectOnly: vendorTaskId 또는 checkpoint가 있는 태스크만 claim → task_get 수거는 추가 과금 0원.
 *   미제출 태스크를 실행하거나 자동순위를 생성하지 않는다(의도치 않은 과금 차단).
 * - 모든 태스크가 종결됐는데 status만 pending인 감사(마감 트랜잭션 실패 등 고아 상태)는
 *   candidate 0으로 processAudit→synthesize가 상태를 마감시킨다.
 *
 * ⚠️ 한계: 감사/태스크 선택이 createdAt ASC라, 벤더가 영구 미완료인 오래된 건이 limit 슬롯을
 *   계속 점유하면 다른 건 수거가 지연될 수 있다(현 규모 1~2건에선 미발생). 확장 시 nextAttemptAt
 *   백오프 도입 필요. 자세한 설계는 메모리 [[minteq-vee3-merge]] 참조.
 */
export async function resumeBatch(input: { limit: number; passes: number }) {
  const start = Date.now();
  const deadline = start + HARD_CEILING_MS;
  const eligibleTask: Prisma.SeoTaskWhereInput = {
    status: { in: [...ACTIVE] },
    AND: [{ OR: [{ vendorTaskId: { not: null } }, { resultCheckpoint: { not: Prisma.DbNull } }] }],
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
  };
  const audits = await prisma.seoAudit.findMany({
    where: {
      status: "pending",
      OR: [
        // Release stale untouched reservations even when no vendor result can be collected.
        { createdAt: { lte: new Date(start - ABANDONED_AUDIT_MS) },
          tasks: abandonedAuditTasks(new Date(start - ABANDONED_AUDIT_MS)) },
        // Discovery finished but reservation scheduling was interrupted. No paid POST in cron.
        { AND: [
          { frozenConfig: { path: ["metricScheduling"], equals: "waiting" } },
          { tasks: { none: { operation: { in: ["labs_ranked", "keywords_for_site"] }, status: { in: [...ACTIVE] } } } },
        ] },
        // 수거할 제출 태스크가 있는 감사.
        { tasks: { some: eligibleTask } },
        // 활성 태스크가 전혀 없어 마감(synthesize)만 남은 고아 감사.
        // ⚠️ autoRankings=true는 synthesize가 pending을 유지하므로 제외(기아 방지).
        //    자동순위 예약은 과금을 수반하는 온디맨드 resume 소관.
        {
          AND: [
            { tasks: { none: { status: { in: [...ACTIVE] } } } },
            { NOT: { frozenConfig: { path: ["autoRankings"], equals: true } } },
          ],
        },
      ],
    },
    select: { id: true, frozenConfig: true, domain: { select: { ownerId: true } } },
    orderBy: { createdAt: "asc" },
    take: input.limit,
  });

  const processed: {
    auditId: string;
    passes: number;
    collected: number;
    error: boolean;
  }[] = [];

  for (const audit of audits) {
    if (Date.now() + PASS_BUDGET_MS >= deadline) break;
    const ownerId = audit.domain.ownerId;
    let passes = 0;
    let error = false;
    const before = await settledCount(audit.id);
    let settled = before;

    // 활성 태스크가 없으면 수거할 게 없고 상태만 pending → 한 번 돌려 synthesize로 마감.
    if ((await activeCount(audit.id)) === 0) {
      try {
        await processAudit(ownerId, audit.id, { collectOnly: true });
        passes = 1;
      } catch {
        error = true;
      }
      processed.push({ auditId: audit.id, passes, collected: 0, error });
      continue;
    }

    while (passes < input.passes && Date.now() + PASS_BUDGET_MS < deadline) {
      if ((await collectableCount(audit.id)) === 0) {
        // Expire stale reservations or advance waiting state without never-submitted POSTs.
        if (passes === 0) {
          try { await processAudit(ownerId, audit.id, { collectOnly: true }); passes++; }
          catch { error = true; }
        }
        break;
      }
      try {
        await processAudit(ownerId, audit.id, { collectOnly: true });
      } catch {
        // 한 감사의 실패가 배치 전체를 막지 않도록 격리한다.
        error = true;
        break;
      }
      passes += 1;
      // 이번 패스에 수거(종결)가 늘지 않았다면 남은 건 벤더 대기분 → 다음 실행으로 넘긴다.
      const now = await settledCount(audit.id);
      if (now <= settled) break;
      settled = now;
    }
    processed.push({ auditId: audit.id, passes, collected: settled - before, error });
  }

  return { scanned: audits.length, processed, durationMs: Date.now() - start };
}
