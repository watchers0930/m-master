import { jsonError } from "@/lib/api-response";

import {
  type ProjectOperatorRole,
  ProjectOperatorAuthError,
  requireProjectOperatorRole,
} from "./project-operator-service";

export async function authorizeProjectRoute(request: Request, projectId: string, minimumRole: ProjectOperatorRole) {
  try {
    const operator = await requireProjectOperatorRole(request, projectId, minimumRole);
    return {
      ok: true as const,
      operator,
    };
  } catch (error) {
    if (error instanceof ProjectOperatorAuthError) {
      return {
        ok: false as const,
        response: jsonError(error.message, error.status),
      };
    }

    throw error;
  }
}

