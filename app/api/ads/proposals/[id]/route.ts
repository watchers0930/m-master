// app/api/ads/proposals/[id]/route.ts — 제안 상세(GET)·편집(PATCH {expected_updated_at, payload}).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 모든 조회는 세션 ownerId 범위 — 남의 제안 id는 404(IDOR). 편집은 잠금 + CAS(409 version_conflict) + 린트·입찰 재검증(lib/ads/proposal-review.ts).
import { adsRoute } from "@/lib/ads/http";
import { editProposal } from "@/lib/ads/proposal-review";
import { getProposal } from "@/lib/ads/proposals";
import { jsonOk, parseBody, readJsonBody } from "@/lib/visibility/http";
import { adsProposalEditSchema } from "@/schemas/ads-proposal";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => jsonOk(await getProposal(ownerId, (await context.params).id)));
}

export async function PATCH(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const { id } = await context.params;
    const input = parseBody(adsProposalEditSchema, await readJsonBody(request));
    return jsonOk(await editProposal(ownerId, id, input));
  });
}
