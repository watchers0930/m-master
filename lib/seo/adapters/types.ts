import { z } from "zod";
export const safeUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  });
export const pageSchema = z.object({
  url: safeUrl,
  status: z.number().int().nullable(),
  title: z.string().max(2000).nullable(),
  description: z.string().max(4000).nullable(),
  canonical: z.string().max(2048).nullable(),
  h1: z.array(z.string().max(2000)).max(100).nullable(),
  checks: z.record(z.string(), z.boolean()),
});
export const metricSchema = z.object({
  keyword: z.string().min(1).max(200),
  engine: z.enum(["google", "naver"]),
  searchVolume: z.number().int().nonnegative().nullable(),
  volumeScale: z.string().max(200).nullable(),
  volumePeriod: z.string().max(200).nullable(),
  competition: z.number().min(0).max(1).nullable(),
  competitionRaw: z.string().max(200).nullable(),
});
export const observationSchema = z.object({
  keyword: z.string().min(1).max(200),
  engine: z.enum(["google", "naver"]),
  source: z.enum(["serp", "labs"]),
  rank: z.number().int().positive().nullable(),
  rankAbsolute: z.number().int().positive().nullable(),
  matchedUrl: safeUrl.nullable(),
  status: z.enum([
    "ranked",
    "not_found_in_range",
    "no_result",
    "unsupported",
    "failed",
    "pending",
  ]),
  returnedRange: z.number().int().nonnegative().nullable(),
  sourceObservedAt: z.iso.datetime().nullable(),
});
export const collectionSchema = z.object({
  extendedStatus: z
    .enum([
      "no_errors",
      "site_unreachable",
      "invalid_page_status_code",
      "forbidden_meta_tag",
      "forbidden_robots",
      "forbidden_http_header",
      "too_many_redirects",
      "unknown",
    ])
    .nullable(),
  stopReason: z
    .enum([
      "limit_exceeded",
      "empty_queue",
      "force_stopped",
      "unexpected_exception",
    ])
    .nullable(),
});
export const checkpointSchema = z.object({
  observedAt: z.iso.datetime().default(() => new Date().toISOString()),
  collection: collectionSchema.nullable().default(null),
  pages: z.array(pageSchema).max(20).default([]),
  pageFailures: z
    .array(
      z.object({
        url: safeUrl,
        reason: z.enum([
          "vendor_failed",
          "missing_task",
          "url_mismatch",
          "duplicate_task",
          "missing_page",
        ]),
        vendorStatus: z.number().nullable(),
      }),
    )
    .max(20)
    .default([]),
  metrics: z.array(metricSchema).max(100).default([]),
  observations: z.array(observationSchema).max(100).default([]),
  crawledPages: z.number().int().nonnegative().nullable().default(null),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type Observation = z.infer<typeof observationSchema>;
export interface FrozenInput {
  host: string;
  market: import("@/types/visibility").Market;
  engine?: "google" | "naver";
  keyword?: string;
  reservedKeywordId?: string;
  paths?: string[];
  keywords?: string[];
}
export const object = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.slice(0, max) : null;
export const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export function url(v: unknown) {
  const r = safeUrl.safeParse(v);
  return r.success ? r.data : null;
}
