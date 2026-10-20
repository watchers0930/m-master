import { auditResponse } from "@/lib/seo/http";
import { authenticated } from "@/lib/visibility/http";
import { idSchema, resumeSchema } from "@/schemas/seo";
import { readJson } from "@/lib/seo/input";
import { resumeAudit } from "@/lib/seo/audit";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return authenticated(async (ownerId) => {
    const id = idSchema.parse((await context.params).id);
    resumeSchema.parse(await readJson(request));
    const data = await resumeAudit(ownerId, id);
    return auditResponse(data);
  }, request);
}
