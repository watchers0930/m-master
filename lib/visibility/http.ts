import { hasSameOriginProof, isCrossSiteMutation } from "@/lib/security/origin";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { requireSession } from "@/lib/auth";
import { VisibilityError } from './errors';
export { VisibilityError } from './errors';
export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}
export function jsonError(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: { code: "bad_request", message: "요청 입력값을 확인하세요." } },
      { status: 400 },
    );
  if (error instanceof Error && error.message === "Unauthorized")
    error = new VisibilityError("unauthorized", "로그인이 필요합니다.", 401);
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    error = new VisibilityError(
      "conflict",
      "이미 등록되었거나 실행 중입니다.",
      409,
    );
  if (error instanceof VisibilityError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message,
        ...("details" in error && typeof error.details === "object" ? error.details : {}),
        ...(["generation_in_progress", "generation_uncertain"].includes(error.code) && "reportId" in error && typeof error.reportId === "string" ? { reportId: error.reportId } : {}),
      } },
      { status: error.status },
    );
  console.error("[visibility] request failed", {
    type: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: "처리하지 못했습니다. 잠시 후 다시 시도하세요.",
      },
    },
    { status: 500 },
  );
}
export async function authenticated(
  work: (ownerId: string) => Promise<Response>,
  request?: Request,
  opts?: { requireOrigin?: boolean },
) {
  try {
    const session = await requireSession();
    if (request && !["GET", "HEAD"].includes(request.method)) {
      if (opts?.requireOrigin && !hasSameOriginProof(request)) {
        throw new VisibilityError("forbidden_origin", "허용되지 않은 요청 출처입니다.", 403);
      }
      if (isCrossSiteMutation(request)) {
        throw new VisibilityError("bad_request", "허용되지 않은 요청 출처입니다.", 400);
      }
    }
    return await work(session.user.id);
  } catch (error) {
    return jsonError(error);
  }
}
/** Route-layer JSON body read; malformed JSON is a 400 (keeps lib functions free of Request/Response). */
export async function readJsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new VisibilityError("bad_request", "JSON 파싱 실패", 400); }
}
/** Validate a body with a zod schema, surfacing the first issue as a 400 `validation` error. */
export function parseBody<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new VisibilityError("validation", parsed.error.issues[0]?.message ?? "validation error", 400);
  return parsed.data;
}
/** Reject duplicate parameters rather than silently selecting one. */
export function queryParams(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in result)
      throw new VisibilityError(
        "bad_request",
        "중복 필터는 허용되지 않습니다.",
        400,
      );
    result[key] = value;
  }
  return result;
}
export function notFound(): never {
  throw new VisibilityError("not_found", "대상을 찾을 수 없습니다.", 404);
}
