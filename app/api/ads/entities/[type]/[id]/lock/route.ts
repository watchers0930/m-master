// app/api/ads/entities/[type]/[id]/lock/route.ts — 미러 엔티티 켜기·끄기(POST {locked, expected_lock_version}).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// [type] = campaign | adgroup | keyword | ad, [id] = 미러 행 id(세션 ownerId 범위, 남의 id는 404).
// CAS 기준은 expected_lock_version이다(계획 brief의 expected_updated_at과 다름 — updatedAt은 동기화마다 바뀌어 거짓 충돌을 낸다).
// 끄기는 항상 허용, 켜기 전제는 lib/ads/locks.ts 머리말.
import { adsRoute } from "@/lib/ads/http";
import { setLock } from "@/lib/ads/locks";
import { notFound } from "@/lib/ads/account-core";
import { jsonOk, parseBody, readJsonBody } from "@/lib/visibility/http";
import { adsLockEntityTypeSchema, adsLockSchema } from "@/schemas/ads";

// 켜기 최악 사슬 = 점유 전 조회 ≤ 180초(LOCK_READ_WINDOW_MS) + 점유 뒤 켜기 PUT 25초 + 재끄기 PUT 25초 + 재조회 45초 + DB ≈ 280초(lib/ads/locks.ts).
// 끄기 = 의도 기록 + PUT 25초 + 재조회 45초. 60초로는 PUT 직후 강제 종료돼 불확실 재끄기가 실행되지 않을 수 있었다(최종 판정 A2).
export const maxDuration = 300;

type Context = { params: Promise<{ type: string; id: string }> };

export async function POST(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const params = await context.params;
    const type = adsLockEntityTypeSchema.safeParse(params.type);
    if (!type.success) throw notFound();
    const input = parseBody(adsLockSchema, await readJsonBody(request));
    return jsonOk(await setLock(ownerId, { type: type.data, id: params.id }, input.locked, input.expected_lock_version));
  });
}
