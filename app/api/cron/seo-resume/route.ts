import { NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { jsonError, jsonOk, queryParams, VisibilityError } from "@/lib/visibility/http";
import { seoCronSchema } from "@/schemas/seo";
import { resumeBatch } from "@/lib/seo/resume-batch";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    if (!verifyCronSecret(request))
      throw new VisibilityError("unauthorized", "인증이 필요합니다.", 401);
    return jsonOk(await resumeBatch(seoCronSchema.parse(queryParams(request))));
  } catch (error) {
    return jsonError(error);
  }
}
