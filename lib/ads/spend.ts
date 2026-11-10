// lib/ads/spend.ts — 오늘(KST) 계정 광고비 = 계정의 모든 캠페인 /stats salesAmt(VAT 별도) 합계. 켜기(locks.ts)·감시(Task 11)가 같은 함수를 쓴다.
// - fail-closed: 목록이 불완전하거나, 응답 형태가 다르거나, 캠페인 하나라도 값이 없으면 0으로 보지 않고 409 spend_unknown.
//   (값이 없는 캠페인이 '비용 0'인지 '집계 안 됨'인지 명세로 확인하지 못했다 ⚠️ — Task 13 실측 후 좁힌다.)
// - ⚠️ /stats 여러 id 형식은 미확인이다. NaverAdsQuery는 배열 값이 없어(Task 3) 쉼표로 이은 ids 하나로 보낸다. 형식은 statsQuery 한 곳에만 둔다.
import type { AdAccount } from "@prisma/client";
import type { NaverAdsClient, NaverAdsQuery } from "@/lib/external/naver-searchad";
import { naverStatsSchema } from "@/schemas/ads";
import { listAllCampaigns } from "./account-core";
import { kstDate } from "./alerts";
import { AdsHttpError } from "./http";

export const STATS_ID_CHUNK = 50;

/** /stats 질의 형식(단일 출처). ids = 쉼표 구분, fields·timeRange = JSON 문자열(KST 날짜 하루). */
export function statsQuery(ids: readonly string[], kstDay: string): NaverAdsQuery {
  return { ids: ids.join(","), fields: JSON.stringify(["salesAmt"]), timeRange: JSON.stringify({ since: kstDay, until: kstDay }) };
}

export const spendUnknown = () =>
  new AdsHttpError("spend_unknown", "오늘 광고비를 확인하지 못했습니다. 상한을 확인할 수 없어 켜지 않았습니다. 잠시 후 다시 시도하세요.", 409);

function unknown(account: Pick<AdAccount, "id">, reason: string): AdsHttpError {
  console.error("[ads] today spend unknown", { accountId: account.id, reason });
  return spendUnknown();
}

export async function todayCostKrw(account: Pick<AdAccount, "id">, client: NaverAdsClient, now: Date = new Date()): Promise<number> {
  let read;
  try {
    read = await listAllCampaigns(client);
  } catch (error) {
    if (error instanceof AdsHttpError && error.code === "ads_unexpected_response") throw unknown(account, "campaign_list_shape");
    throw error;
  }
  if (!read.complete) throw unknown(account, "campaign_list_incomplete");
  const ids = read.campaigns.map((c) => c.nccCampaignId);
  const day = kstDate(now);
  let total = 0;
  for (let i = 0; i < ids.length; i += STATS_ID_CHUNK) {
    const chunk = ids.slice(i, i + STATS_ID_CHUNK);
    const parsed = naverStatsSchema.safeParse(await client.get("/stats", statsQuery(chunk, day)));
    if (!parsed.success) throw unknown(account, "stats_shape");
    const byId = new Map(parsed.data.data.map((row) => [row.id, row.salesAmt]));
    for (const id of chunk) {
      const cost = byId.get(id);
      if (cost === undefined) throw unknown(account, "stats_missing_id");
      total += cost;
    }
  }
  return total;
}
