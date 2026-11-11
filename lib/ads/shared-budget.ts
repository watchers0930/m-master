// lib/ads/shared-budget.ts — 계정 공유예산 `mq-cap` 조회·대조(설계서 §5.4: 상한 4중 강제의 네이버 쪽 1층).
// 핫픽스(2026-11-11, 실호출 400/1002 — 대장 승인 설계 A): 네이버는 공유예산을 같은 유형 캠페인 1개 이상(campaignList)과 함께만 만든다(#834).
// - 연결(accounts.ts)은 더 이상 만들지 않는다. 이미 있는 mq-cap(캠페인 유형)이 재조회 + verifyStored('sharedBudget')를 통과하면 그 id만 쓴다
//   (reuseSharedBudget). 없으면 null로 연결이 끝나고, 첫 적용이 캠페인과 함께 만든다(apply-budget.ts).
// - 찾기: DB의 sharedBudgetId 우선, 없으면 이름 mq-cap, DELETED 제외. 둘 이상이면 고르지 않는다(호출자가 멈춤).
// - 상한을 넘게 바뀐 기존 예산은 조용히 쓰지 않는다(연결 409 shared_budget_unsafe, 적용은 drift).
import { z } from "zod";
import type { AdAccount } from "@prisma/client";
import type { NaverAdsClient } from "@/lib/external/naver-searchad";
import { naverSharedBudgetListSchema } from "@/schemas/ads";
import { AdsHttpError, unexpectedNaverResponse } from "./http";
import { SHARED_BUDGET_NAME, verifyStored, type CapAccount } from "./requests";

export type BudgetAccount = CapAccount & Pick<AdAccount, "id" | "ownerId">;
export type BudgetRead = { ok: true; dailyBudget: number } | { ok: false; field: string };

/** 살아 있는 후보 id: preferredId가 살아 있으면 그것 하나, 아니면 이름 mq-cap인 것 전부(0·1·여럿 — 고르기는 호출자). */
export async function sharedBudgetCandidates(client: Pick<NaverAdsClient, "get">, preferredId: string | null): Promise<string[]> {
  const parsed = naverSharedBudgetListSchema.safeParse(await client.get("/ncc/shared-budgets"));
  if (!parsed.success) throw unexpectedNaverResponse();
  const live = parsed.data.filter((b) => b.status !== "DELETED");
  if (preferredId && live.some((b) => b.sharedBudgetId === preferredId)) return [preferredId];
  return live.filter((b) => b.name === SHARED_BUDGET_NAME).map((b) => b.sharedBudgetId);
}

const amountSchema = z.object({ dailyBudget: z.number().int() });

/** 단건 재조회 + verifyStored('sharedBudget'). 통과하면 저장된 하루 금액(≤ 상한)을 돌려준다. */
export async function readSharedBudget(client: Pick<NaverAdsClient, "get">, account: CapAccount, id: string): Promise<BudgetRead> {
  const raw = await client.get(`/ncc/shared-budgets/${id}`);
  const verdict = verifyStored("sharedBudget", { ...account, sharedBudgetId: id }, raw);
  if (!verdict.ok) return verdict;
  return { ok: true, dailyBudget: amountSchema.parse(raw).dailyBudget }; // verifyStored가 이미 정수·상한 이하를 확인했다
}

/** 연결: 이미 있는 mq-cap을 재사용(검증 통과한 것만). 없으면 null — 생성하지 않는다. DB 저장은 호출자가 한다. */
export async function reuseSharedBudget(client: NaverAdsClient, account: BudgetAccount): Promise<string | null> {
  const found = await sharedBudgetCandidates(client, account.sharedBudgetId);
  if (found.length > 1)
    throw new AdsHttpError("shared_budget_ambiguous", `네이버에 '${SHARED_BUDGET_NAME}' 공유예산이 여러 개입니다. 하나만 남기고 다시 연결하세요.`, 409);
  const id = found[0];
  if (!id) return null;
  const verdict = await readSharedBudget(client, account, id);
  if (!verdict.ok)
    throw new AdsHttpError(
      "shared_budget_unsafe", "네이버 공유예산 설정이 MINTEQ 상한과 다릅니다. 네이버 화면에서 공유예산을 확인한 뒤 다시 연결하세요.", 409,
      { field: verdict.field },
    );
  return id;
}
