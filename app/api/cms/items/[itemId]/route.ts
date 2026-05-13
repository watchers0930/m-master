import { jsonError, jsonOk } from "../../../../../lib/api-response";
import { revalidatePath } from "next/cache";
import { logger } from "../../../../../server/logger";
import {
  CmsItemNotFoundError,
  removeCmsItem,
  saveCmsItem,
} from "../../../../../server/services/cms-service";
import {
  CmsValidationError,
  parseItemUpdateInput,
} from "../../../../../server/validators/cms-validator";

type RouteContext = {
  params: Promise<{
    itemId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { itemId } = await context.params;

  try {
    const input = await parseItemUpdateInput(request);
    const sections = await saveCmsItem({
      itemId,
      ...input,
    });
    revalidatePath("/");
    revalidatePath("/cms");

    return jsonOk({ sections });
  } catch (error) {
    if (error instanceof CmsValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof CmsItemNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("cms.item.update.failed", {
      itemId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("CMS 항목을 저장하지 못했습니다.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { itemId } = await context.params;

  try {
    const sections = await removeCmsItem(itemId);
    revalidatePath("/");
    revalidatePath("/cms");
    return jsonOk({ sections });
  } catch (error) {
    if (error instanceof CmsItemNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("cms.item.delete.failed", {
      itemId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("CMS 항목을 삭제하지 못했습니다.", 500);
  }
}
