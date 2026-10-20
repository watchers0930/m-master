import { z } from "zod";
import { marketSchema } from "@/lib/market/schema";
const id = z.string().cuid();
const text = z.string().min(1).max(600);
const channel = z.enum(["organic", "geo", "naver_paid"]);
const ratio = z.number().int().min(0).max(100);
const refs = z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).min(1).max(30);
export const currencySchema = z.enum(["KRW", "USD", "GBP", "CAD", "AUD"]);
export const consultingCreateSchema = z.strictObject({
    domainId: id,
    market: marketSchema.optional(),
    monthlyMarketingBudget: z.strictObject({
        amount: z.number().int().min(0).max(10000000000), currency: currencySchema,
    }).optional(),
});
export const consultingQuerySchema = z.strictObject({
    domainId: id, reportId: id.optional(), cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const evidenceSchema = z.strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    source: z.enum(["seo", "geo", "ga4", "status"]), label: text,
    value: z.union([z.number().finite(), z.string().max(600), z.null()]),
    unit: z.string().max(40).optional(), observedAt: z.iso.datetime().nullable(),
    rangeFrom: z.iso.datetime().nullable().optional(), rangeTo: z.iso.datetime().nullable().optional(),
});
export const consultingSnapshotSchema = z.strictObject({
    market: marketSchema,
    range: z.strictObject({ from: z.iso.datetime(), to: z.iso.datetime() }),
    evidence: z.array(evidenceSchema).max(700),
    sourceStatus: z.array(z.strictObject({ source: z.enum(["seo", "geo", "ga4", "status"]),
        status: z.enum(["available", "partial", "missing", "stale", "error", "unmapped"]),
        observedAt: z.iso.datetime().nullable(), reason: text.nullable(),
    })).max(4),
    limitations: z.array(text).max(20),
    selection: z.array(z.strictObject({ source: z.string().max(80), total: z.number().int().nonnegative(),
        selected: z.number().int().nonnegative(), limit: z.number().int().positive(), rule: text,
    })).max(10),
    monthlyMarketingBudget: consultingCreateSchema.shape.monthlyMarketingBudget.unwrap().nullable(),
});
const finding = z.strictObject({ text, evidenceIds: refs });
export const consultingStrategySchema = z.strictObject({
    diagnosis: z.strictObject({ summary: text, strengths: z.array(finding).max(5),
        issues: z.array(finding).max(5), uncertainties: z.array(text).max(5) }),
    channelMix: z.array(z.strictObject({ channel, applicability: z.enum(["applicable", "not_applicable"]),
        recommendedRatio: ratio, reason: text, evidenceIds: refs })).length(3),
    budgetProposal: z.strictObject({ totalAmount: z.number().min(0).max(10000000000).nullable(), currency: currencySchema,
        allocations: z.array(z.strictObject({ channel, ratio, amount: z.number().nonnegative().nullable() })).length(3),
        assumptions: z.array(text).max(5) }),
    priorityActions: z.array(z.strictObject({ id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
        priority: z.enum(["P0", "P1", "P2"]), channel, title: z.string().min(1).max(80), description: text,
        evidenceIds: refs, metric: z.string().min(1).max(100),
        destination: z.enum(["content_create", "seo_audit", "visibility"]),
    })).min(1).max(10),
});
