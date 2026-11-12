// lib/ads/proposal-estimate.ts — 저장된 제안의 키워드별 예상 순위(B4, POST /api/ads/proposals/[id]/estimate — 본문 없음).
// - 접근: 허용목록(assertAdsOwner) + 세션 ownerId 범위. 남의 제안·형식이 틀린 id는 404(IDOR) — 네이버 호출 0.
// - 키워드·입찰가는 저장된 제안 payload에서만 온다(클라이언트 입력 없음). 계정은 제안의 계정, 클라이언트는 clientForAccount(withAccountClient).
// - 읽기 전용: 비상 정지 스위치·원장·execution.ts와 무관하다(판정 2). 키 무효(401)는 기존대로 계정을 invalid_key로 바꾼다.
// - 1분 제한: 같은 사용자·같은 제안은 60초에 1번(메모리 — 서버 인스턴스마다 따로라 최선 노력이다. 네이버 호출 한도 보호용이며 보안 경계가 아니다).
//   소유 확인·계정 활성 확인 뒤에 잡는다(남의 시도나 보낼 수 없는 계정이 내 제한을 잡지 않게). 잡은 뒤에는 실패해도 풀지 않는다(재시도 폭주 방지).
// - 전체 호출 마감 ESTIMATE_BUDGET_MS(라우트 maxDuration 안). 넘기면 남은 묶음은 보내지 않고 503 ads_unavailable.
import { prisma } from "@/lib/prisma";
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { isEntityId } from "@/schemas/id";
import type { ProposalEstimateDTO, ProposalEstimateRowDTO } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { loadOwnedAccount, notFound, withAccountClient, type AdsDeps } from "./account-core";
import { ESTIMATE_DEVICES, estimatePositionBids, expectedPosition, type KeywordEstimate } from "./estimate";
import { AdsHttpError } from "./http";
import { bidRangeOf, payloadOf } from "./proposals";

export const ESTIMATE_COOLDOWN_MS = 60_000;
export const ESTIMATE_BUDGET_MS = 100_000;
const recent = new Map<string, number>(); // `${ownerId}:${proposalId}` → 조회 시각(ms)

/** 테스트 전용 초기화(HTTP로 닿지 않는다). */
export function resetEstimateGuard(): void {
  recent.clear();
}

/** 남은 대기 ms(0이면 잡았다). 만료된 항목은 매번 지워 맵이 계속 자라지 않는다. */
function claim(key: string, now: number): number {
  for (const [k, at] of recent) if (now - at >= ESTIMATE_COOLDOWN_MS) recent.delete(k);
  const at = recent.get(key);
  if (at !== undefined) return ESTIMATE_COOLDOWN_MS - (now - at);
  recent.set(key, now);
  return 0;
}

const cooldown = (waitMs: number) =>
  new AdsHttpError("ads_estimate_cooldown", "예상 순위는 같은 제안에서 1분에 한 번만 조회할 수 있습니다. 잠시 후 다시 시도하세요.", 429, {
    retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)),
  });

export async function estimateProposal(ownerId: string, id: string, deps: AdsDeps = {}): Promise<ProposalEstimateDTO> {
  assertAdsOwner(ownerId);
  if (!isEntityId(id)) throw notFound();
  const row = await prisma.adProposal.findFirst({ where: { id, ownerId }, select: { id: true, adAccountId: true, payload: true } });
  if (!row) throw notFound();
  const account = await loadOwnedAccount(ownerId, row.adAccountId);
  if (account.status !== "active") throw new NaverAdsError("ads_not_connected"); // 보낼 수 없는 계정 — 1분 제한을 잡지 않는다

  const entries = payloadOf(row).groups
    .flatMap((g) => (Array.isArray(g.keywords) ? g.keywords : []))
    .filter((k) => typeof k?.keyword === "string" && k.keyword.length > 0 && typeof k.bidAmt === "number")
    .map((k) => ({ keyword: k.keyword, bid: k.bidAmt }));

  let tables = new Map<string, KeywordEstimate>();
  if (entries.length > 0) {
    const wait = claim(`${ownerId}:${row.id}`, Date.now());
    if (wait > 0) throw cooldown(wait);
    const deadline = Date.now() + ESTIMATE_BUDGET_MS;
    const callBudget = deps.callBudget ?? (() => deadline - Date.now());
    tables = await withAccountClient(account, { ...deps, callBudget }, (client) =>
      estimatePositionBids(client, entries.map((e) => e.keyword), ESTIMATE_DEVICES));
  }

  const rows: ProposalEstimateRowDTO[] = entries.map(({ keyword, bid }) => {
    const t = tables.get(keyword) ?? { PC: {}, MOBILE: {} };
    return { keyword, bid, PC: t.PC, MOBILE: t.MOBILE, expected: { PC: expectedPosition(bid, t.PC), MOBILE: expectedPosition(bid, t.MOBILE) } };
  });
  return { fetchedAt: new Date().toISOString(), devices: [...ESTIMATE_DEVICES], bidRange: bidRangeOf(account), rows };
}
