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
      { error: { code: error.code, message: error.message } },
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
  work: (ownerId: string) => Promise<NextResponse>,
  request?: Request,
) {
  try {
    if (request && !["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (
        request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && origin !== new URL(request.url).origin)
      ) {
        throw new VisibilityError(
          "bad_request",
          "허용되지 않은 요청 출처입니다.",
          400,
        );
      }
    }
    const session = await requireSession();
    return await work(session.user.id);
  } catch (error) {
    return jsonError(error);
  }
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
