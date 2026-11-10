// lib/ads/shared-budget.ts — 계정 공유예산 `mq-cap` 확인·생성(설계서 §5.4: 상한 4중 강제의 네이버 쪽 1층).
// - 멱등: 먼저 목록에서 찾는다(DB의 sharedBudgetId 우선, 없으면 이름 mq-cap, DELETED 제외). 둘 이상이면 고르지 않고 중단.
// - 생성은 buildSharedBudget 본문으로 1회만 POST. 결과가 불확실(5xx·형태 불일치)하면 재전송하지 않고 이름으로 재조회한다.
// - 재사용·생성 모두 단건 재조회 + verifyStored('sharedBudget')를 통과해야 쓴다. 상한을 넘게 바뀐 기존 예산은 조용히 쓰지 않는다.
// - 비상 정지 스위치(ADS_EXECUTION_ENABLED)와 무관: 공유예산은 지출 상한을 '세우는' 쓰기다. 캠페인이 없거나 모두 꺼진 상태에서
//   상한만 만들 뿐 노출·과금을 켜지 않는다(끄기와 같은 안전 방향). 계획 Task 13 Step 6(스위치 off에서 mq-cap 생성 확인)과 일치.
import type { AdAccount } from "@prisma/client";
import type { NaverAdsClient } from "@/lib/external/naver-searchad";
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { naverSharedBudgetCreatedSchema, naverSharedBudgetListSchema } from "@/schemas/ads";
import { AdsHttpError, unexpectedNaverResponse } from "./http";
import { sendMutation } from "./oplog";
import { SHARED_BUDGET_NAME, buildSharedBudget, verifyStored, type CapAccount } from "./requests";

export type BudgetAccount = CapAccount & Pick<AdAccount, "id" | "ownerId">;

async function findExisting(client: NaverAdsClient, preferredId: string | null): Promise<string | null> {
  const parsed = naverSharedBudgetListSchema.safeParse(await client.get("/ncc/shared-budgets"));
  if (!parsed.success) throw unexpectedNaverResponse();
  const live = parsed.data.filter((b) => b.status !== "DELETED");
  if (preferredId && live.some((b) => b.sharedBudgetId === preferredId)) return preferredId;
  const named = live.filter((b) => b.name === SHARED_BUDGET_NAME);
  if (named.length > 1)
    throw new AdsHttpError("shared_budget_ambiguous", `네이버에 '${SHARED_BUDGET_NAME}' 공유예산이 여러 개입니다. 하나만 남기고 다시 연결하세요.`, 409);
  return named[0]?.sharedBudgetId ?? null;
}

async function create(client: NaverAdsClient, account: BudgetAccount): Promise<string> {
  const body = buildSharedBudget({ ...account, sharedBudgetId: null });
  try {
    const created = await sendMutation(
      client, account, { step: "shared_budget.create", method: "POST", path: "/ncc/shared-budgets", body },
      naverSharedBudgetCreatedSchema, (r) => r.sharedBudgetId,
    );
    return created.sharedBudgetId;
  } catch (error) {
    if (!(error instanceof NaverAdsError) || error.reason !== "ads_uncertain") throw error;
    // 반영 여부 불명: 재전송 금지, 이름으로 대조
    const found = await findExisting(client, null);
    if (found) return found;
    throw new AdsHttpError(
      "shared_budget_uncertain", "공유예산 생성 결과를 확인하지 못했습니다. 잠시 후 다시 연결하세요(중복 생성하지 않습니다).", 502,
    );
  }
}

/** 공유예산 id를 돌려준다(검증 통과한 것만). DB 저장은 호출자가 한다. */
export async function ensureSharedBudget(client: NaverAdsClient, account: BudgetAccount): Promise<string> {
  const id = (await findExisting(client, account.sharedBudgetId)) ?? (await create(client, account));
  const stored = await client.get(`/ncc/shared-budgets/${id}`);
  const verdict = verifyStored("sharedBudget", { ...account, sharedBudgetId: id }, stored);
  if (!verdict.ok)
    throw new AdsHttpError(
      "shared_budget_unsafe", "네이버 공유예산 설정이 MINTEQ 상한과 다릅니다. 네이버 화면에서 공유예산을 확인한 뒤 다시 연결하세요.", 409,
      { field: verdict.field },
    );
  return id;
}
