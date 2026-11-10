// lib/ads/spend.ts — 오늘(KST) 계정 광고비 = 계정의 모든 캠페인 /stats salesAmt(VAT 별도) 합계. 켜기(locks.ts)·감시(Task 11)가 같은 함수를 쓴다.
// - fail-closed: 캠페인 목록이 불완전하거나, /stats 응답 본문이 없거나 형태가 다르면 0으로 보지 않고 409 spend_unknown.
// - 통제자 판정(Task 9 concern 3): 형태가 맞는(parse된) **비어 있지 않은** 응답에서 빠진 캠페인은 0원으로 센다 — 네이버는 활동 없는 행을 빼는 것으로 보인다.
//   최종 판정 A1: id를 실은 요청의 유효한 응답이 행 0개(data:[])면 spend_unknown(fail-closed → 감시 guard_blind). 같은 id 행이 여럿이면 합산.
//   재검토 N2(빈 응답 교착 해소): 빈 묶음은 그 묶음의 **모든** 캠페인이 같은 실행의 완전한 목록에서 꺼져 있고(isCampaignOff)
//   editTm이 오늘 KST 0시 전(오늘 켜지거나 수정·생성되지 않음 = 오늘 노출·비용이 생길 수 없음)일 때만 0원. 하나라도 켜짐·오늘 수정·
//   editTm 없음/파싱 불가면 그대로 spend_unknown. 감시·대장 켜기·재개가 모두 이 함수를 쓰므로 규칙은 여기 한 곳에만 둔다.
//   ⚠️ 미확인(Task 13 실측: 노출·클릭 0인 캠페인이 /stats 응답에 행으로 오는지, 빠지는지 확인하고 이 주석·코드를 좁힌다).
// - ⚠️ /stats 여러 id 형식은 미확인이다. NaverAdsQuery는 배열 값이 없어(Task 3) 쉼표로 이은 ids 하나로 보낸다. 형식은 statsQuery 한 곳에만 둔다.
import type { AdAccount } from "@prisma/client";
import type { NaverAdsClient, NaverAdsQuery } from "@/lib/external/naver-searchad";
import { naverStatsSchema } from "@/schemas/ads";
import { isCampaignOff, listAllCampaigns, type CampaignRead } from "./account-core";
import { kstDate, kstDayStart } from "./alerts";
import { AdsHttpError } from "./http";

export const STATS_ID_CHUNK = 50;

/** 여러 id 질의 값(단일 출처): 쉼표로 잇는다. /stats·/ncc/keywords?ids·/ncc/ads?ids가 같이 쓴다. ⚠️ 형식 Task 13 실측 대상. */
export function idsParam(ids: readonly string[]): string {
  return ids.join(",");
}

/** /stats 질의 형식(단일 출처). ids = 쉼표 구분, fields·timeRange = JSON 문자열(KST 날짜 하루). 성과 수집(sync-stats)은 fields를 넘긴다. */
export function statsQuery(ids: readonly string[], kstDay: string, fields: readonly string[] = ["salesAmt"]): NaverAdsQuery {
  return { ids: idsParam(ids), fields: JSON.stringify(fields), timeRange: JSON.stringify({ since: kstDay, until: kstDay }) };
}

export const spendUnknown = () =>
  new AdsHttpError("spend_unknown", "오늘 광고비를 확인하지 못했습니다. 상한을 확인할 수 없어 켜지 않았습니다. 잠시 후 다시 시도하세요.", 409);

function unknown(account: Pick<AdAccount, "id">, reason: string): AdsHttpError {
  console.error("[ads] today spend unknown", { accountId: account.id, reason });
  return spendUnknown();
}

/** 오늘 0시 전부터 꺼진 채 바뀌지 않은 캠페인(오늘 비용이 생길 수 없음). editTm 없음·파싱 불가 = 모름 = false. */
function offSinceBeforeToday(c: CampaignRead["campaigns"][number] | undefined, dayStartMs: number): boolean {
  if (!c || !isCampaignOff(c) || typeof c.editTm !== "string") return false;
  const edited = Date.parse(c.editTm);
  return Number.isFinite(edited) && edited < dayStartMs;
}

export async function todayCostKrw(account: Pick<AdAccount, "id">, client: Pick<NaverAdsClient, "get">, now: Date = new Date()): Promise<number> {
  let read;
  try {
    read = await listAllCampaigns(client);
  } catch (error) {
    if (error instanceof AdsHttpError && error.code === "ads_unexpected_response") throw unknown(account, "campaign_list_shape");
    throw error;
  }
  if (!read.complete) throw unknown(account, "campaign_list_incomplete");
  const ids = read.campaigns.map((c) => c.nccCampaignId);
  const byId = new Map(read.campaigns.map((c) => [c.nccCampaignId, c]));
  const day = kstDate(now);
  const dayStartMs = kstDayStart(now).getTime();
  let total = 0;
  for (let i = 0; i < ids.length; i += STATS_ID_CHUNK) {
    const chunk = ids.slice(i, i + STATS_ID_CHUNK);
    const parsed = naverStatsSchema.safeParse(await client.get("/stats", statsQuery(chunk, day)));
    if (!parsed.success) throw unknown(account, "stats_shape");
    // id를 실어 보냈는데 유효한 응답이 행 0개면 0원으로 보지 않는다(ids 형식 오해·빈 응답이 감시를 조용히 끄지 않게, 최종 판정 A1)
    if (parsed.data.data.length === 0) {
      if (!chunk.every((id) => offSinceBeforeToday(byId.get(id), dayStartMs))) throw unknown(account, "stats_empty");
      continue; // 묶음 전체가 어제 이전부터 꺼짐 → 0원(재검토 N2)
    }
    const wanted = new Set(chunk);
    // 같은 캠페인 행이 여럿이면 합산한다(마지막 값만 남기면 과소 계산). 요청하지 않은 id 행은 무시한다.
    // ⚠️ 비어 있지 않은 유효 응답에 없는 캠페인 = 활동 없음 = 0원(Task 13 실측 대상)
    for (const row of parsed.data.data) if (wanted.has(row.id)) total += row.salesAmt;
  }
  return total;
}
