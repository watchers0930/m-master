import { pageCursor } from "@/lib/visibility/cursor";
import { z } from "zod";
import { marketSchema, engineSchema } from "@/lib/market/schema";
import { normalizeHost } from "@/lib/visibility/normalize";
export const idSchema = z.string().cuid();
export const enginesSchema = z
  .array(engineSchema)
  .min(1)
  .max(4)
  .refine(
    (v) => new Set(v).size === v.length,
    "엔진 중복은 허용되지 않습니다.",
  );
const alias = z.string().trim().min(1).max(100);
const fields = {
  query: z.string().trim().min(1).max(1000),
  domainId: idSchema.nullable().optional(),
  market: marketSchema.optional(),
  engines: enginesSchema.optional(),
  brandAliases: z.array(alias).min(1).max(20),
  competitorAliases: z.array(alias).max(20).optional(),
  frequency: z.enum(["daily", "weekly"]).optional(),
  active: z.boolean().optional(),
};
export const queryCreateSchema = z.strictObject(fields);
export const queryPatchSchema = queryCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "수정할 필드가 필요합니다.");
export const domainCreateSchema = z.strictObject({
  url: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .transform((v, ctx) => {
      try {
        return normalizeHost(v);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "유효한 도메인을 입력하세요.",
        });
        return z.NEVER;
      }
    }),
  market: marketSchema.optional(),
  businessType: z.string().trim().min(1).max(100).optional(),
});
const limit = (fallback: number) =>
  z.coerce.number().int().min(1).max(100).default(fallback);
export const domainListSchema = z.strictObject({ limit: limit(100) });
export const queryListSchema = z.strictObject({
  cursor: pageCursor.optional(),
  limit: limit(50),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  domainId: idSchema.optional(),
  market: marketSchema.optional(),
});
export const snapshotSchema = z.strictObject({
  queryId: idSchema,
  engines: enginesSchema.optional(),
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
    "유효한 ISO 날짜가 필요합니다.",
  );
export const dataSchema = z
  .strictObject({
    market: marketSchema.default("ko-KR"),
    queryId: idSchema.optional(),
    domainId: idSchema.optional(),
    engine: engineSchema.optional(),
    citationLimit: limit(50),
    citationCursor: pageCursor.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .transform((v) => {
    const to = v.to
      ? new Date(v.to.length === 10 ? `${v.to}T23:59:59.999Z` : v.to)
      : new Date();
    const from = v.from
      ? new Date(v.from)
      : new Date(to.getTime() - 30 * 86400000);
    return { ...v, from, to };
  })
  .refine(
    (v) =>
      v.from <= v.to && v.to.getTime() - v.from.getTime() <= 366 * 86400000,
    "조회 기간은 366일 이내여야 합니다.",
  );
export const cronSchema = z.strictObject({
  frequency: z.enum(["daily", "weekly"]).optional(),
  limit: limit(10),
});
export type QueryCreateInput = z.infer<typeof queryCreateSchema>;
export type QueryPatchInput = z.infer<typeof queryPatchSchema>;
