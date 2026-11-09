import { authenticated, jsonOk, VisibilityError } from "@/lib/visibility/http";
import { snapshotSchema } from "@/schemas/visibility";
import { capture } from "@/lib/visibility/track";
import { VENDOR_PAYMENT_REQUIRED_MESSAGE } from "@/lib/external/dataforseo";
export const maxDuration = 300;
export async function POST(request: Request) {
  return authenticated(async (ownerId) => {
    const input = snapshotSchema.parse(await request.json());
    const results = await capture(ownerId, input.queryId, input.engines, {
      immediate: true,
    });
    const unpaid = (r: { failReason?: string }) =>
      r.failReason === "vendor_payment_required";
    if (results.length && results.every((r) => r.status === "failed")) {
      if (results.some(unpaid))
        throw new VisibilityError(
          "vendor_payment_required",
          VENDOR_PAYMENT_REQUIRED_MESSAGE,
          503,
        );
      throw new VisibilityError(
        "upstream_failed",
        "외부 수집에 실패했습니다. 잠시 후 다시 시도하세요.",
        502,
      );
    }
    return jsonOk({
      results: results.map((result) => ({
        engine: result.engine,
        status: result.status,
        snapshotId: result.snapshotId,
        ...(result.failReason
          ? {
              failReason:
                result.status === "pending"
                  ? "수집 결과를 확인 중입니다. 잠시 후 다시 확인하세요."
                  : unpaid(result)
                    ? VENDOR_PAYMENT_REQUIRED_MESSAGE
                    : "일시적으로 수집 또는 판정을 완료하지 못했습니다.",
            }
          : {}),
      })),
    });
  }, request);
}
