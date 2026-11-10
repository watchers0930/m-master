// app/api/ads/proposals/route.ts — AI 광고 제안 목록(GET, 키셋 페이지)·생성(POST). 허용목록 밖은 404, 변이는 같은 출처 증명 필수.
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 입력은 schemas/ads-proposal.ts strict 검증(수동 씨앗 ≤ 25개·≤ 40자). 생성은 네이버 키워드 도구 조회 + LLM 최대 2회 호출이다.
import { logAudit } from "@/lib/audit/logger";
import { adsRoute } from "@/lib/ads/http";
import { createProposal, listProposals } from "@/lib/ads/proposals";
import { jsonOk, parseBody, queryParams, readJsonBody } from "@/lib/visibility/http";
import { adsProposalCreateSchema, adsProposalListSchema } from "@/schemas/ads-proposal";

export const maxDuration = 180; // 키워드 리서치(최대 5회 GET) + LLM 2회(각 60초 제한)

export async function GET(request: Request) {
  return adsRoute(request, async (ownerId) => jsonOk(await listProposals(ownerId, parseBody(adsProposalListSchema, queryParams(request)))));
}

export async function POST(request: Request) {
  return adsRoute(request, async (ownerId) => {
    const input = parseBody(adsProposalCreateSchema, await readJsonBody(request));
    const proposal = await createProposal(ownerId, input);
    await logAudit({ actor: ownerId, action: "ads.proposal_create", targetType: "ad_proposal", targetId: proposal.id, payload: { costKrw: proposal.costKrw } });
    return jsonOk(proposal, 201);
  });
}
