import { jsonError, jsonOk } from "../../../../lib/api-response";
import { logger } from "../../../../server/logger";
import { previewProjectContext } from "../../../../server/services/project-service";
import { parseCreateProjectInput, ProjectValidationError } from "../../../../server/validators/project-validator";

export async function POST(request: Request) {
  try {
    const input = await parseCreateProjectInput(request);
    const preview = await previewProjectContext(input);

    return jsonOk({ preview });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    logger.error("projects.context_preview.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("컨텍스트 초안 미리보기를 생성하지 못했습니다.", 500);
  }
}
