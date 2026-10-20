import { createHash } from "node:crypto";
import { z } from "zod";
import { VisibilityError } from "@/lib/visibility/http";
const shape = z.strictObject({
  at: z.iso.datetime(),
  id: z.string().cuid(),
  filter: z.string().length(64),
});
export function filterHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function decodeCursor(value: string | undefined, filter: unknown) {
  if (!value) return null;
  try {
    const cursor = shape.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (cursor.filter !== filterHash(filter)) throw new Error();
    return cursor;
  } catch {
    throw new VisibilityError(
      "bad_request",
      "조회 조건과 일치하는 커서가 필요합니다.",
      400,
    );
  }
}
export function encodeCursor(at: Date, id: string, filter: unknown) {
  return Buffer.from(
    JSON.stringify({ at: at.toISOString(), id, filter: filterHash(filter) }),
  ).toString("base64url");
}
export function after(cursor: ReturnType<typeof decodeCursor>, field: string) {
  return cursor
    ? {
        OR: [
          { [field]: { lt: new Date(cursor.at) } },
          { [field]: new Date(cursor.at), id: { gt: cursor.id } },
        ],
      }
    : {};
}
