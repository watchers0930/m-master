import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { dataSchema } from "@/schemas/visibility";
import { visibilityData } from "@/lib/visibility/data";
export async function GET(request: Request) {
  return authenticated(async (ownerId) =>
    jsonOk(
      await visibilityData(ownerId, dataSchema.parse(queryParams(request))),
    ),
  );
}
