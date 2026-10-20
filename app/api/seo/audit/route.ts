import { auditResponse } from "@/lib/seo/http";
import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { auditSchema, auditListSchema } from "@/schemas/seo";
import { readJson } from "@/lib/seo/input";
import { runAudit } from "@/lib/seo/audit";
import { listAudits } from "@/lib/seo/data";
export const maxDuration = 60;
export async function POST(request: Request) {
  return authenticated(async (ownerId) => {
    const input = auditSchema.parse(await readJson(request));
    const result = await runAudit(ownerId, input, "full");
    return auditResponse(result.data, result.reused);
  }, request);
}
export async function GET(request: Request) {
  return authenticated(
    async (ownerId) =>
      jsonOk(
        await listAudits(ownerId, auditListSchema.parse(queryParams(request))),
      ),
    request,
  );
}
