// app/api/ads/groups/[id]/extensions/route.ts — 광고그룹 확장소재(3.6단계). [id] = 광고그룹 미러 행 id(세션 ownerId 범위, 남의 id는 404).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// GET: 네이버의 이 그룹 확장소재 현황(조회만, lib/ads/extensions/list.ts).
// POST {headline?, promo?, subLinks?}: 대장이 확인한 내용을 등록(lib/ads/extensions/apply.ts — 린트·서브링크 생존·유형별 생성 점유·원장).
//   비상 정지 스위치가 꺼져 있으면 503 ads_paused(네이버 쓰기 0).
// DELETE ?type=HEADLINE|DESCRIPTION|SUB_LINKS: 10분 넘게 끝나지 않은 등록 점유 풀기(네이버 목록 재확인 → 채택 또는 점유 삭제, 네이버 쓰기 없음).
// 호출부: hooks/useAdExtensions.ts.
import { adsRoute } from "@/lib/ads/http";
import { applyExtensions } from "@/lib/ads/extensions/apply";
import { groupExtensions, releaseExtension } from "@/lib/ads/extensions/list";
import { jsonOk, parseBody, readJsonBody } from "@/lib/visibility/http";
import { adsExtensionApplySchema } from "@/schemas/ads-extension";

// 최악 사슬 = 채널 GET 45초 + 링크 확인 ≈ 20초 + 목록 GET 45초 + 유형 3개 × (POST 25초 + 불확실 대조 GET 45초). 넘기면 점유 행이 creating으로 남고
// 10분 뒤 다음 등록이 원장을 보고 재전송 없이 대조한다(lib/ads/extensions/apply.ts).
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => jsonOk(await groupExtensions(ownerId, (await context.params).id)));
}

export async function POST(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const { id } = await context.params;
    const input = parseBody(adsExtensionApplySchema, await readJsonBody(request));
    return jsonOk(await applyExtensions(ownerId, id, input));
  });
}

export async function DELETE(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const { id } = await context.params;
    return jsonOk(await releaseExtension(ownerId, id, new URL(request.url).searchParams.get("type")));
  });
}
