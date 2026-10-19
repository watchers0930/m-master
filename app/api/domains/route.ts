import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { domainCreateSchema, domainListSchema } from "@/schemas/visibility";
import { listDomains, createDomain } from "@/lib/visibility/domains";
export async function GET(request: Request) {
  return authenticated(async (ownerId) => {
    const { limit } = domainListSchema.parse(queryParams(request));
    return jsonOk(await listDomains(ownerId, limit));
  });
}
export async function POST(request: Request) {
  return authenticated(
    async (ownerId) =>
      jsonOk(
        await createDomain(
          ownerId,
          domainCreateSchema.parse(await request.json()),
        ),
        201,
      ),
    request,
  );
}
