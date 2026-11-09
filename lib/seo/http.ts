import { jsonOk, VisibilityError } from "@/lib/visibility/http";
import type { SeoAuditDTO } from "@/types/seo";
import { PAYMENT_REQUIRED_MESSAGE } from "./messages";
/** Preserve partial/uncertain reports; only a final all-task vendor failure is a gateway error. */
export function auditResponse(data: SeoAuditDTO, reused = false) {
  if (
    !reused &&
    data.status === "failed" &&
    data.tasks.length > 0 &&
    data.tasks.every((task) => task.status === "failed") &&
    data.tasks.some((task) => task.failReason === "외부 수집에 실패했습니다.") &&
    // A 502 discards the DTO on the client; keep the actionable balance notice visible.
    !data.tasks.some((task) => task.failReason === PAYMENT_REQUIRED_MESSAGE)
  ) {
    throw new VisibilityError(
      "external_failed",
      "외부 수집에 실패했습니다. 같은 요청 키로 결과를 확인하세요.",
      502,
    );
  }
  return jsonOk(data, reused ? 200 : data.status === "pending" ? 202 : 200);
}
