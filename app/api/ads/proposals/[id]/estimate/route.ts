// app/api/ads/proposals/[id]/estimate/route.ts — 제안 키워드의 순위별 예상 입찰가(B4, GET, 읽기 전용).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 키워드는 저장된 제안에서만 읽는다 — 쿼리 파라미터는 하나라도 있으면 400(클라이언트 키워드 입력 없음). 남의 제안은 404.
// 비상 정지 스위치·원장과 무관(쓰기 아님). 같은 제안은 60초에 1번(429 ads_estimate_cooldown). 네이버 오류는 광고 오류 매핑(naverCode 전달).
import { adsRoute } from "@/lib/ads/http";
import { estimateProposal } from "@/lib/ads/proposal-estimate";
import { jsonOk } from "@/lib/visibility/http";
import { VisibilityError } from "@/lib/visibility/errors";

// 키워드 최대 100개 × 기기 2 = 40묶음(25항목씩)을 차례로 — 내부 호출 마감(ESTIMATE_BUDGET_MS 100초)보다 길게
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    if (new URL(request.url).searchParams.size > 0) throw new VisibilityError("validation", "이 조회는 입력을 받지 않습니다.", 400);
    return jsonOk(await estimateProposal(ownerId, (await context.params).id));
  });
}
