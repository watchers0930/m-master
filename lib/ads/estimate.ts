// lib/ads/estimate.ts — 순위별 예상 입찰가(B4). 네이버 POST /estimate/average-position-bid/keyword(공식 java-sample rest/Estimate.java).
// - 읽기 전용 조회다: HTTP 메서드는 POST지만 네이버에 아무것도 만들거나 바꾸지 않는다. 그래서 비상 정지 스위치(execution.ts)·
//   원장(oplog.ts)을 거치지 않는다(판정 2). 보낼 수 있는 경로는 ESTIMATE_PATHS뿐이다(소스 검사 post-allowlist.test.cjs가 고정).
// - 클라이언트의 POST는 1회만 보낸다(재시도 없음 — 조회라도 안전한 방향). 5xx는 '반영 여부 불확실'이 아니라 일시 장애로 바꾼다(쓰기가 아니므로).
// - 묶음 상한은 명세에 없다(⚠️ 미확인) → 키워드×순위 항목 25개씩 나눠 차례로 보낸다(동시 호출 없음).
// - 응답: 바깥 형태가 틀리면 502 형식 오류. 항목은 하나씩 검사해 틀린 항목·요청하지 않은 키워드/순위는 버린다.
//   키워드는 그대로 같거나, 공백·대소문자만 다를 때(네이버 정규화 가능성) 요청한 키워드에 붙인다(겹치면 버린다).
// - exposure-minimum-bid(노출 최소 입찰가)는 응답 형태가 확인되지 않아 쓰지 않는다(판정의 '형태를 모르면 뺀다').
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { naverPositionBidItemSchema, naverPositionBidResponseSchema } from "@/schemas/ads";
import type { EstimateDevice, EstimatePosition, ExpectedPosition, PositionBidTable } from "@/types/ads";
import { unexpectedNaverResponse } from "./http";

export const ESTIMATE_PATHS = ["/estimate/average-position-bid/keyword"] as const;
const POSITION_BID_PATH = ESTIMATE_PATHS[0];
export const ESTIMATE_POSITIONS: readonly EstimatePosition[] = [1, 2, 3, 4, 5];
export const ESTIMATE_DEVICES: readonly EstimateDevice[] = ["PC", "MOBILE"];
export const MAX_ESTIMATE_ITEMS = 25;
export const BELOW_FIFTH = "6위 이하";

export type KeywordEstimate = Record<EstimateDevice, PositionBidTable>;
export type EstimateClient = Pick<NaverAdsClient, "post">;
type Item = { key: string; position: EstimatePosition };

const loose = (k: string) => k.replace(/\s+/g, "").toUpperCase();

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function postBatch(client: EstimateClient, device: EstimateDevice, items: Item[]): Promise<unknown[]> {
  let raw: unknown;
  try {
    raw = await client.post(POSITION_BID_PATH, { device, items });
  } catch (error) {
    // 읽기 요청이라 '반영됐는지 모름'은 없다 — 일시 장애로 알린다(코드·상태는 그대로)
    if (error instanceof NaverAdsError && error.reason === "ads_uncertain") throw new NaverAdsError("ads_unavailable", error.naverCode, error.status);
    throw error;
  }
  const parsed = naverPositionBidResponseSchema.safeParse(raw);
  if (!parsed.success) throw unexpectedNaverResponse();
  return parsed.data.estimate;
}

/** 키워드별·기기별 1~5위 예상 입찰가. 키워드는 중복을 없애고 순서를 지킨다. 빈 목록이면 네이버를 부르지 않는다. */
export async function estimatePositionBids(
  client: EstimateClient,
  keywords: readonly string[],
  devices: readonly EstimateDevice[] = ESTIMATE_DEVICES,
): Promise<Map<string, KeywordEstimate>> {
  const unique = [...new Set(keywords)];
  const result = new Map<string, KeywordEstimate>(unique.map((k) => [k, { PC: {}, MOBILE: {} }]));
  const byLoose = new Map<string, string | null>(); // 느슨한 키 → 요청 키워드(둘 이상이면 null = 모호해서 버림)
  for (const k of unique) byLoose.set(loose(k), byLoose.has(loose(k)) ? null : k);
  const items: Item[] = unique.flatMap((key) => ESTIMATE_POSITIONS.map((position) => ({ key, position })));

  for (const device of [...new Set(devices)]) {
    for (const batch of chunks(items, MAX_ESTIMATE_ITEMS)) {
      const asked = new Set(batch.map((i) => `${i.key}\u0000${i.position}`));
      for (const raw of await postBatch(client, device, batch)) {
        const item = naverPositionBidItemSchema.safeParse(raw);
        if (!item.success) continue;
        const keyword = result.has(item.data.keyword) ? item.data.keyword : byLoose.get(loose(item.data.keyword));
        if (!keyword) continue;
        const position = item.data.position as EstimatePosition;
        if (!asked.has(`${keyword}\u0000${position}`)) continue;
        result.get(keyword)![device][position] = item.data.bid;
      }
    }
  }
  return result;
}

/**
 * 내 입찰가로 예상되는 순위: table[p] ≤ bid 인 가장 좋은(작은) p. 빠진 순위는 건너뛴다.
 * 어느 순위에도 못 미치면 5위 값이 있을 때만 '6위 이하'(그보다 낮다고 확인됨), 5위 값이 없으면 null(판단 못 함).
 */
export function expectedPosition(bid: number, table: PositionBidTable): ExpectedPosition {
  for (const p of ESTIMATE_POSITIONS) {
    const v = table[p];
    if (v !== undefined && v <= bid) return p;
  }
  return table[5] !== undefined ? BELOW_FIFTH : null;
}
