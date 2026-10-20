import { auditResponse } from "@/lib/seo/http";
import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { rankingSchema, rankingListSchema } from "@/schemas/seo";
import { readJson } from "@/lib/seo/input";
import { runAudit } from "@/lib/seo/audit";
import { listRankings } from "@/lib/seo/data";
export const maxDuration = 60;
export async function POST(request: Request) {
  return authenticated(async (ownerId) => {
    const result = await runAudit(
      ownerId,
      rankingSchema.parse(await readJson(request)),
      "ranking",
    );
    return auditResponse(result.data, result.reused);
  }, request);
}
export async function GET(request: Request) {
  return authenticated(
    async (ownerId) =>
      jsonOk(
        await listRankings(
          ownerId,
          rankingListSchema.parse(queryParams(request)),
        ),
      ),
    request,
  );
}
