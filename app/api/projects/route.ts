import { jsonError, jsonOk } from "../../../lib/api-response";
import { logger } from "../../../server/logger";
import { getCurrentProjectOperatorAccessIdentity } from "../../../server/services/project-operator-service";
import { createProject, getProjectListForOperatorIdentity, ProjectNotFoundError } from "../../../server/services/project-service";
import { parseCreateProjectInput, ProjectValidationError } from "../../../server/validators/project-validator";

export async function GET(request: Request) {
  try {
    const operatorIdentity = await getCurrentProjectOperatorAccessIdentity(request);
    const projects = operatorIdentity
      ? await getProjectListForOperatorIdentity({
          name: operatorIdentity.name,
          accessKeyHash: operatorIdentity.accessKeyHash,
        })
      : [];

    return jsonOk({ projects });
  } catch (error) {
    logger.error("projects.list.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("프로젝트 목록을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseCreateProjectInput(request);
    const operatorIdentity = await getCurrentProjectOperatorAccessIdentity(request);
    const project = await createProject(input, {
      creatorOperator: operatorIdentity
        ? {
            name: operatorIdentity.name,
            accessKeyHash: operatorIdentity.accessKeyHash,
          }
        : null,
    });

    return jsonOk({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.create.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("프로젝트를 생성하지 못했습니다.", 500);
  }
}
