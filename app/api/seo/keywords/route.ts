import { auditResponse } from "@/lib/seo/http";
import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { researchSchema, keywordListSchema } from "@/schemas/seo";
import { readJson } from "@/lib/seo/input";
import { runAudit } from "@/lib/seo/audit";
import { listKeywords } from "@/lib/seo/data";
export const maxDuration = 60;
export async function POST(request: Request) {
  return authenticated(async (ownerId) => {
    const result = await runAudit(
      ownerId,
      researchSchema.parse(await readJson(request)),
      "research",
    );
    return auditResponse(result.data, result.reused);
  }, request);
}
export async function GET(request: Request) {
  return authenticated(
    async (ownerId) =>
      jsonOk(
        await listKeywords(
          ownerId,
          keywordListSchema.parse(queryParams(request)),
        ),
      ),
    request,
  );
}
