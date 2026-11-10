// lib/ads/access.ts — 광고 기능 접근 허용목록(env ADS_OWNER_IDS, 쉼표 구분 userId). 설계서 §5.7.
// - 목록에 없으면 존재 자체를 숨긴다(404). env가 없거나 비면 아무도 허용하지 않는다(fail-closed).
// - 요청마다 env를 다시 읽는다(작은 문자열 split — 캐시 불필요, env 변경이 재배포 없이 반영되는 환경에서도 안전).
import { VisibilityError } from "@/lib/visibility/errors";

function ownerIds(): Set<string> {
  return new Set((process.env.ADS_OWNER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function isAdsOwner(ownerId: unknown): boolean {
  return typeof ownerId === "string" && ownerId.length > 0 && ownerIds().has(ownerId);
}

export function assertAdsOwner(ownerId: unknown): asserts ownerId is string {
  if (!isAdsOwner(ownerId)) throw new VisibilityError("not_found", "대상을 찾을 수 없습니다.", 404);
}
