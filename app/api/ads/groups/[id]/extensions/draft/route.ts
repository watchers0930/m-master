// app/api/ads/groups/[id]/extensions/draft/route.ts — 광고그룹 확장소재 AI 초안(POST, 본문 없음). 저장·네이버 쓰기 없음(채널 조회·사이트맵 읽기만).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 비용: AI 호출마다 비용 원장(kind 'ads'). 결과 {draft, issues, pages, landingHost, costKrw}. 호출부: hooks/useAdExtensions.ts.
import { adsRoute } from "@/lib/ads/http";
import { draftExtensions } from "@/lib/ads/extensions/draft";
import { jsonOk } from "@/lib/visibility/http";

export const maxDuration = 180; // AI 60초 × 2(교정 1회) + 채널 조회·사이트맵

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => jsonOk(await draftExtensions(ownerId, (await context.params).id)));
}
