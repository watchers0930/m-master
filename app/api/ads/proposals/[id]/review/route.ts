// app/api/ads/proposals/[id]/review/route.ts — 제안 승인·반려(POST {decision, expected_updated_at, reason?}).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 잠금 + CAS + 감사로그(ads.proposal_approve|reject). 승인은 pending_review에서만, 남은 린트 위반 0건일 때만. 네이버는 부르지 않는다(적용은 별도).
import { adsRoute } from "@/lib/ads/http";
import { reviewProposal } from "@/lib/ads/proposal-review";
import { jsonOk, parseBody, readJsonBody } from "@/lib/visibility/http";
import { adsProposalReviewSchema } from "@/schemas/ads-proposal";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const { id } = await context.params;
    const input = parseBody(adsProposalReviewSchema, await readJsonBody(request));
    return jsonOk(await reviewProposal(ownerId, id, input));
  });
}
