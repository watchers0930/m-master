import { z } from "zod";
import { marketSchema } from "@/lib/market/schema";
export const idSchema = z.string().cuid();
export const seoEngineSchema = z.enum(["google", "naver"]);
const engines = z
  .array(seoEngineSchema)
  .min(1)
  .max(2)
  .refine((v) => new Set(v).size === v.length);
const ids = z
  .array(idSchema)
  .min(1)
  .max(10)
  .refine((v) => new Set(v).size === v.length);
const base = { domainId: idSchema, runKey: z.string().uuid() };
export const pathSchema = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const decoded = decodeURIComponent(v);
      const u = new URL(v, "https://seo.invalid");
      return (
        v.startsWith("/") &&
        !decoded.startsWith("//") &&
        !/[\\\s#]/.test(decoded) &&
        !Array.from(decoded).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ) &&
        u.host === "seo.invalid" &&
        u.search.length <= 512
      );
    } catch {
      return false;
    }
  });
export const auditSchema = z.strictObject({
  ...base,
  mode: z.enum(["instant", "crawl"]).default("instant"),
  paths: z.array(pathSchema).min(1).max(5).optional(),
  engines: engines.optional(),
  keywordIds: ids.optional(),
});
export const keywordSchema = z
  .string()
  .transform((v) => v.normalize("NFKC").trim())
  .pipe(z.string().min(1).max(200));
export const researchSchema = z.strictObject({
  ...base,
  keywords: z
    .array(keywordSchema)
    .max(50)
    .transform((v) => [...new Map(v.map((k) => [k.toLowerCase(), k])).values()])
    .optional(),
});
export const rankingSchema = z
  .strictObject({ ...base, keywordIds: ids, engines })
  .refine((v) => v.keywordIds.length * v.engines.length <= 10);
export const resumeSchema = z.strictObject({});
export const cursorSchema = z.string().max(1000);
const list = {
  domainId: idSchema,
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
export const auditListSchema = z.strictObject({
  ...list,
  auditId: idSchema.optional(),
});
export const keywordListSchema = z.strictObject({
  ...list,
  engine: seoEngineSchema.optional(),
  market: marketSchema.optional(),
  search: z.string().max(200).optional(),
});
const date = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
        v,
      ) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v.slice(0, 10)).toISOString().slice(0, 10) === v.slice(0, 10),
  );
export const rankingListSchema = z
  .strictObject({
    ...list,
    keywordId: idSchema.optional(),
    engine: seoEngineSchema.optional(),
    device: z.enum(["desktop", "mobile"]).optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .transform((v) => {
    const to = v.to
      ? new Date(v.to.length === 10 ? `${v.to}T23:59:59.999Z` : v.to)
      : new Date(`${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`);
    return {
      ...v,
      from: v.from ? new Date(v.from) : new Date(to.getTime() - 30 * 86400000),
      to,
    };
  })
  .refine(
    (v) =>
      v.from <= v.to && v.to.getTime() - v.from.getTime() <= 366 * 86400000,
  );
