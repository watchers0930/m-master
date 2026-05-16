import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { getProjectListForOperatorCredentials } from "@/server/services/project-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          accessKey?: string;
        }
      | null;

    const name = body?.name?.trim() || "";
    const accessKey = body?.accessKey?.trim() || "";

    if (!name || !accessKey) {
      return jsonError("운영자 이름과 접근 키를 입력한 뒤 내 프로젝트를 확인하세요.", 400);
    }

    const projects = await getProjectListForOperatorCredentials({
      name,
      accessKey,
    });

    if (projects.length === 0) {
      return jsonError("이 계정으로 접근 가능한 프로젝트를 찾지 못했습니다.", 404);
    }

    return jsonOk({ projects });
  } catch (error) {
    logger.error("projects.access.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("내 프로젝트 목록을 불러오지 못했습니다.", 500);
  }
}
