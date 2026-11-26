// lib/ops/report/checks/cost.ts — 이번 달(KST) AI·데이터 비용: 종류별 합계, 소유자별 한도(min(플랜 상한, 월 예산)) 대비 사용률.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-time";
import { monthStartKst } from "@/lib/visibility/budget";
import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import { krw, type CheckContext, type CheckResult } from "../types";

export const COST_WARN_RATIO = 0.8;
// 이번 달 비용이 있는 소유자 전부를 본다(지출 상위만 자르면 한도가 작은 계정의 초과를 놓침 — codex MED). 상한은 폭주 방지용.
export const MAX_OWNERS = 1000;
const KIND_KO: Record<string, string> = {
  chat: "AI 글·판정", embedding: "임베딩", consulting: "컨설팅", seo: "SEO 진단", visibility: "GEO 수집", ads: "광고 제안",
};
type Kind = { kind: string; krw: number };
type Owner = { owner_id: string; email: string | null; plan: string; budget: number | null; krw: number };

export async function checkCost({ now }: CheckContext, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<CheckResult> {
  const base = { key: "cost", title: "이번 달 AI·데이터 비용" };
  const start = monthStartKst(now);
  const kinds = await db.$queryRaw<Kind[]>`
    SELECT kind, coalesce(sum(krw),0)::float AS krw FROM cost_ledger WHERE occurred_at >= ${utcTimestamp(start)} GROUP BY kind ORDER BY 2 DESC`;
  const owners = await db.$queryRaw<Owner[]>`
    SELECT c.owner_id, u.email, u.plan, s.budget_monthly AS budget, sum(c.krw)::float AS krw
    FROM cost_ledger c JOIN users u ON u.id = c.owner_id LEFT JOIN settings s ON s.owner_id = c.owner_id
    WHERE c.occurred_at >= ${utcTimestamp(start)} GROUP BY c.owner_id, u.email, u.plan, s.budget_monthly LIMIT ${MAX_OWNERS}`;
  const total = kinds.reduce((n, k) => n + k.krw, 0);
  const [{ owners: ownerCount }] = await db.$queryRaw<{ owners: number }[]>`
    SELECT count(DISTINCT owner_id)::int AS owners FROM cost_ledger WHERE occurred_at >= ${utcTimestamp(start)}`;
  const lines = [kinds.length ? kinds.map((k) => `${KIND_KO[k.kind] ?? k.kind} ${krw(k.krw)}`).join(" · ") : "기록 없음"];
  let level = "ok" as CheckResult["level"];
  for (const o of owners) {
    const plan = (o.plan in PLAN_LIMITS ? o.plan : "free") as PlanKey;
    const cap = Math.min(PLAN_LIMITS[plan].costLimitKrw, o.budget ?? 500000);
    // 한도 0(예산 0원)인데 비용이 났으면 그 자체가 초과다.
    const ratio = cap > 0 ? o.krw / cap : o.krw > 0 ? Infinity : 0;
    if (ratio >= COST_WARN_RATIO) {
      level = "warn";
      lines.push(`${o.email ?? o.owner_id}: ${krw(o.krw)} / 한도 ${krw(cap)} (${Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "예산 0원"})`);
    }
  }
  if (ownerCount > owners.length) { level = "warn"; lines.push(`비용이 있는 계정 ${ownerCount}개 중 ${owners.length}개만 한도를 확인했습니다(상한 ${MAX_OWNERS}).`); }
  const summary = `합계 ${krw(total)}${level === "warn" ? " — 확인할 계정이 있습니다." : ""}`;
  return { ...base, level, summary, lines };
}
