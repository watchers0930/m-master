import { authenticated, jsonOk } from "@/lib/visibility/http";
import { idSchema, queryPatchSchema } from "@/schemas/visibility";
import { patchQuery, deleteQuery } from "@/lib/visibility/queries";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return authenticated(async (ownerId) => {
    const id = idSchema.parse((await context.params).id);
    return jsonOk(
      await patchQuery(
        ownerId,
        id,
        queryPatchSchema.parse(await request.json()),
      ),
    );
  }, request);
}
export async function DELETE(request: Request, context: Context) {
  return authenticated(
    async (ownerId) =>
      jsonOk(
        await deleteQuery(ownerId, idSchema.parse((await context.params).id)),
      ),
    request,
  );
}
