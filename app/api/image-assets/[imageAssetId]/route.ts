import { jsonError } from "@/lib/api-response";
import { resolveImageAssetPayload } from "@/server/services/image-delivery-service";

type RouteContext = {
  params: Promise<{
    imageAssetId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { imageAssetId } = await context.params;
  const payload = await resolveImageAssetPayload(imageAssetId);

  if (!payload) {
    return jsonError("이미지 자산을 찾을 수 없습니다.", 404);
  }

  return new Response(payload.buffer, {
    status: 200,
    headers: {
      "Content-Type": payload.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
