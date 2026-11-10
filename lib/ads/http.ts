// lib/ads/http.ts — 광고 API 라우트 공통 래퍼와 오류 매핑.
// - 순서: 로그인(401) → 변이는 같은 출처 증명(403) → 허용목록(404) → 작업. 응답은 항상 Cache-Control: no-store.
// - 오류 본문은 고정 문구 + 코드만. 키·네이버 본문·원인은 싣지 않는다.
//   · CredentialCryptoError(키 env·앵커 문제) → 503 credential_storage_unavailable — "무효 키"로 위장하지 않는다.
//   · NaverAdsError → 사유별 코드. ads_auth_failed는 저장된 계정 키가 무효가 된 경우다(연결·교체 시 새 키 거부는 ads_key_rejected 400).
import { CredentialCryptoError } from "@/lib/crypto/credentials";
import { NaverAdsError, type NaverAdsReason } from "@/lib/external/naver-searchad";
import { authenticated } from "@/lib/visibility/http";
import { VisibilityError } from "@/lib/visibility/errors";
import { assertAdsOwner } from "./access";
import { AdsInvariantError } from "./invariants";

/** details는 jsonError가 error 객체에 펼쳐 싣는다(내부 코드가 만든 값만). */
export class AdsHttpError extends VisibilityError {
  constructor(code: string, message: string, status: number, public details?: Record<string, string | number | null>) {
    super(code, message, status);
  }
}

const NAVER: Readonly<Record<NaverAdsReason, [string, string, number]>> = {
  ads_auth_failed: ["ads_key_invalid", "네이버 API 키가 더 이상 유효하지 않습니다. 새 키로 교체하세요.", 409],
  ads_forbidden: ["ads_forbidden", "이 광고 계정 리소스에 접근할 권한이 없습니다.", 409],
  ads_rate_limited: ["ads_rate_limited", "네이버 호출 한도에 걸렸습니다. 잠시 후 다시 시도하세요.", 429],
  ads_rejected: ["ads_rejected", "네이버가 요청을 거절했습니다.", 422],
  ads_uncertain: ["ads_uncertain", "네이버 반영 여부를 확인하지 못했습니다. 잠시 후 다시 확인하세요.", 502],
  ads_unavailable: ["ads_unavailable", "네이버 광고 API에 연결하지 못했습니다. 잠시 후 다시 시도하세요.", 503],
  ads_not_connected: ["ads_not_connected", "연결되지 않았거나 키가 무효인 광고 계정입니다.", 409],
};

export function toAdsHttpError(error: unknown): unknown {
  if (error instanceof CredentialCryptoError) {
    console.error("[ads] credential storage unavailable", { reason: error.reason });
    return new VisibilityError("credential_storage_unavailable", "광고 키를 안전하게 저장·사용할 수 없습니다. 관리자에게 문의하세요.", 503);
  }
  if (error instanceof NaverAdsError) {
    const [code, message, status] = NAVER[error.reason] ?? NAVER.ads_unavailable;
    return new AdsHttpError(code, message, status, error.naverCode !== undefined ? { naverCode: error.naverCode } : undefined);
  }
  if (error instanceof AdsInvariantError) return new AdsHttpError("ads_invariant", "광고 상한 규칙을 지키지 못하는 요청입니다.", 422, { field: error.field });
  return error;
}

/** 광고 라우트 공통: 인증·출처·허용목록 + 오류 매핑 + no-store. */
export function adsRoute(request: Request, work: (ownerId: string) => Promise<Response>): Promise<Response> {
  return authenticated(
    async (ownerId) => {
      assertAdsOwner(ownerId);
      try {
        return await work(ownerId);
      } catch (error) {
        throw toAdsHttpError(error);
      }
    },
    request,
    { requireOrigin: true },
  ).then((response) => {
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

/** 네이버 성공 본문 parse 실패(조회) — 형태를 모르는 값으로 판단하지 않는다. */
export function unexpectedNaverResponse(): AdsHttpError {
  return new AdsHttpError("ads_unexpected_response", "네이버 응답 형식이 예상과 다릅니다. 잠시 후 다시 시도하세요.", 502);
}
