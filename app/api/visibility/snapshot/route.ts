import { authenticated, jsonOk, VisibilityError } from "@/lib/visibility/http";
import { snapshotSchema } from "@/schemas/visibility";
import { capture } from "@/lib/visibility/track";
export const maxDuration = 300;
export async function POST(request: Request) {
  return authenticated(async (ownerId) => {
    const input = snapshotSchema.parse(await request.json());
    const results = await capture(ownerId, input.queryId, input.engines, {
      immediate: true,
    });
    if (results.length && results.every((r) => r.status === "failed"))
      throw new VisibilityError(
        "upstream_failed",
        "외부 수집에 실패했습니다. 잠시 후 다시 시도하세요.",
        502,
      );
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
                  : "일시적으로 수집 또는 판정을 완료하지 못했습니다.",
            }
          : {}),
      })),
    });
  }, request);
}
