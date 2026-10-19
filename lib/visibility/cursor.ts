import { z } from "zod";
export const pageCursor = z.string().max(1000).transform((value, ctx) => {
  try {
    return z.object({ at: z.iso.datetime(), id: z.string().min(1).max(100), offset: z.number().int().min(0).default(0) })
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    ctx.addIssue({ code: "custom", message: "유효한 커서가 필요합니다." });
    return z.NEVER;
  }
});
export function encodeCursor(at: Date | string, id: string, offset = 0) {
  return Buffer.from(JSON.stringify({ at: typeof at === "string" ? at : at.toISOString(), id, offset })).toString("base64url");
}
