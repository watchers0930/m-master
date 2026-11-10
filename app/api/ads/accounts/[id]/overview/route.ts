// app/api/ads/accounts/[id]/overview/route.ts — 광고 계정 개요(GET): 계정·감시 스냅샷(나이 포함)·미러 4종·7/30일 성과. DB만 읽는다(네이버 호출 없음).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 모든 조회는 세션 ownerId 범위 — 남의 계정 id는 404(IDOR). 응답 DTO에는 keyLast4만 있다(키 원문·암호문 없음). 호출부: hooks/useAdsOverview.ts.
import { adsRoute } from "@/lib/ads/http";
import { getOverview } from "@/lib/ads/overview";
import { jsonOk } from "@/lib/visibility/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => jsonOk(await getOverview(ownerId, (await context.params).id)));
}
