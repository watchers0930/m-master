import { z } from "zod";
const count = z.number().int().nonnegative();
const value = z.number().finite().nonnegative().nullable();
const period = z.strictObject({from: z.string().max(40), to: z.string().max(40)}).nullable();
const refs = z.array(z.string().max(100)).max(10000);
const selection = z.strictObject({total: count, selected: count, limit: count, rule: z.string().max(600)}).nullable();
export const sectionMetaSchema = z.strictObject({
  sourceStatus: z.enum(["available","partial","missing","stale","error","unmapped"]), reason: z.string().max(600).nullable(),
  evidenceIds: refs, observedAt: z.iso.datetime().nullable(), market: z.string().max(20), location: z.number().int().positive().nullable(),
  period, unit: z.string().max(80).nullable(), currency: z.enum(["KRW","USD","GBP","CAD","AUD"]).nullable(),
  selection, coverage: z.number().min(0).max(1).nullable(),
});
export const sectionKeywordSchema = z.strictObject({keywordId: z.string().max(100), keyword: z.string().min(1).max(200),
  difficulty: z.number().int().min(0).max(100).nullable(), volume: z.number().int().nonnegative().nullable(), cpc: value,
  adCompetition: z.enum(["LOW","MEDIUM","HIGH"]).nullable(), adValue: value,
  rank: z.number().int().positive().nullable(), rankSource: z.string().max(80).nullable(), period, status: z.string().max(80),
});
export const structuredMetricsSchema = z.strictObject({
  keywords: z.array(sectionKeywordSchema.extend({evidenceIds: refs, currency: z.enum(["KRW","USD","GBP","CAD","AUD"]).nullable()})).max(50),
  demand: z.array(z.strictObject({keywordId: z.string().max(100), location: z.number().int().positive(), year: z.number().int().min(2000).max(2200),
    month: z.number().int().min(1).max(12), volume: count, evidenceId: z.string().max(100)})).max(600),
  period, location: z.number().int().positive(),
});
export function sectionsSchema(strategy: z.ZodType) {
  const section = <T extends z.ZodRawShape>(shape: T) => z.strictObject({meta: sectionMetaSchema, ...shape});
  return z.strictObject({
    summary: section({monthly: z.array(z.strictObject({location: z.number().int(),year: count,month: z.number().int().min(1).max(12),volume: count,evidenceId: z.string().max(100)})).max(600),
      observedMonths: z.array(z.string()).max(600), missingMonths: z.array(z.string()).max(600)}),
    focus: section({items: z.array(sectionKeywordSchema.pick({keywordId:true,difficulty:true,volume:true,cpc:true,adCompetition:true,adValue:true}).extend({evidenceIds:refs})).max(50)}),
    competitors: section({items: z.array(z.strictObject({source: z.literal("geo"),name:z.string().max(600),metric:z.string().max(80),value:z.number().finite(),evidenceId:z.string().max(100)})).max(20).nullable()}),
    gtm: section({strategy: strategy.nullable()}),
    keywords: section({rows: z.array(sectionKeywordSchema).max(50)}),
    methodology: section({metricDefs:z.array(z.strictObject({key:z.string(),definition:z.string(),source:z.string(),formula:z.string().nullable(),version:z.string()})).max(20),
      selectionLimits:z.array(selection).max(10)}),
  });
}
