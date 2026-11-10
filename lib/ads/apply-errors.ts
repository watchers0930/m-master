// lib/ads/apply-errors.ts — 적용 실패 코드(AdProposal.failCode). 순수 함수(I/O 없음).
// - 형식: drift:<field> | uncertain:<step> | ambiguous:<step> | lint:<Task 7 규칙 id> | rejected:<네이버 code|unknown> |
//   invariant:<field> | ads_paused | ads_not_connected | ads_<사유> | target_adgroup_deleted | 그 밖의 고정 코드. 키·본문·원문 메시지는 넣지 않는다.
// - 네이버 반려 코드 → 린트 규칙 id(Task 7 CARRY): 3909 금지 키워드, 3906 키워드 특수문자, 3822 중복 소재.
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { AdsHttpError } from "./http";
import { AdsInvariantError } from "./invariants";
import { LINT_RULES } from "./lint-rules";

/** 적용을 멈추는 확정 실패(코드가 곧 failCode). */
export class ApplyFailure extends Error {
  constructor(readonly failCode: string) {
    super(`ads_apply_${failCode}`);
    this.name = "ApplyFailure";
  }
}

const REJECTION_RULES: Readonly<Record<number, string>> = {
  3909: LINT_RULES.forbiddenKeyword.id,
  3906: LINT_RULES.keywordSpecialChar.id,
  3822: LINT_RULES.duplicateCreative.id,
};

/** 오류 → failCode. 알 수 없는 오류는 null(호출자는 internal_error로 기록하고 다시 던진다 — 다른 코드로 위장하지 않는다). */
export function failCodeOf(error: unknown, step: string): string | null {
  if (error instanceof ApplyFailure) return error.failCode;
  if (error instanceof NaverAdsError) {
    if (error.reason === "ads_uncertain") return `uncertain:${step}`;
    if (error.reason === "ads_rejected") {
      const rule = error.naverCode !== undefined ? REJECTION_RULES[error.naverCode] : undefined;
      return rule ? `lint:${rule}` : `rejected:${error.naverCode ?? "unknown"}`;
    }
    return error.reason;
  }
  if (error instanceof AdsInvariantError) return `invariant:${error.field}`;
  if (error instanceof AdsHttpError) return error.code;
  return null;
}
