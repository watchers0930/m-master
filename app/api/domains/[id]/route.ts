import { authenticated, jsonOk } from "@/lib/visibility/http";
import { idSchema } from "@/schemas/visibility";
import { deleteDomain } from "@/lib/visibility/domains";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async (ownerId) => jsonOk(
    await deleteDomain(ownerId, idSchema.parse((await context.params).id)),
  ), request);
}
