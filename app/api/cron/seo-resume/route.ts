import { NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { assessResult, cronName, outcomeOf, recordCronRun } from "@/lib/cron/heartbeat";
import { jsonError, jsonOk, queryParams, VisibilityError } from "@/lib/visibility/http";
import { seoCronSchema } from "@/schemas/seo";
import { resumeBatch } from "@/lib/seo/resume-batch";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let authed = false;
  try {
    if (!verifyCronSecret(request))
      throw new VisibilityError("unauthorized", "인증이 필요합니다.", 401);
    authed = true;
    const result = await resumeBatch(seoCronSchema.parse(queryParams(request)));
    const assessed = assessResult(result);
    await recordCronRun(cronName(request), assessed.outcome, assessed.code);
    return jsonOk(result);
  } catch (error) {
    if (authed) { const o = outcomeOf(error); await recordCronRun(cronName(request), o.outcome, o.code); }
    return jsonError(error);
  }
}
