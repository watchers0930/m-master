import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { consultingDomains, consultingDomainQuerySchema } from "@/lib/consulting/domains";
export async function GET(request: Request) {
    return authenticated(async ownerId => jsonOk(await consultingDomains(ownerId,
        consultingDomainQuerySchema.parse(queryParams(request)))));
}
