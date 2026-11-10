// app/api/ads/proposals/[id]/apply/route.ts — 승인된 제안을 네이버에 적용(POST, 본문 없음).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 비상 정지 스위치가 꺼져 있으면 503 ads_paused(점유·네이버 호출 0). 결과 {status:'applied'|'apply_failed', failCode?}.
// 모든 엔티티는 일시중지(userLock=true, lockedBy=pending_launch)로 만든다. 켜기는 /api/ads/entities/[type]/[id]/lock.
import { applyProposal } from "@/lib/ads/apply";
import { adsRoute } from "@/lib/ads/http";
import { jsonOk } from "@/lib/visibility/http";

// 멈춘 applying 회수 기준(10분)보다 짧아야 한다 — 살아 있는 실행이 회수당하지 않게(lib/ads/apply.ts STALE_APPLY_MS).
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const { id } = await context.params;
    return jsonOk(await applyProposal(ownerId, id));
  });
}
