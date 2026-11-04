import { z } from 'zod';
const errorCode = z.enum(['invalid_credentials','permission_denied','quota_exceeded','timeout','upstream_error','invalid_query']);
const source = z.enum(['service_account','owner_oauth','env_oauth','legacy_file']);
export const ga4ProvenanceSchema = z.object({
  ownerId: z.string(), domainId: z.string(), bindingId: z.string(), propertyId: z.string().regex(/^properties\/\d+$/),
  host: z.string().min(1).max(253), credentialSource: source, collectedAt: z.iso.datetime(),
  range: z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  timeZone: z.string().nullable(), queryVersion: z.string(), completeness: z.enum(['complete','partial']),
  quality: z.object({ thresholded: z.boolean().optional(), sampled: z.boolean().optional(), truncatedRows: z.boolean().optional(), dataLossFromOtherRow: z.boolean().optional() }).strict(),
}).strict();
const key = { key: z.string().max(200), evidenceIds: z.array(z.string()).max(10) };
const num = z.number().finite().nonnegative();
export const ga4ConsultingSchema = z.object({
  provenance: ga4ProvenanceSchema,
  reports: z.object({
    channels: z.array(z.object({ ...key, activeUsers: num, sessions: num, engagedSessions: num, engagementRate: num }).strict()).max(20),
    sourceMedium: z.array(z.object({ ...key, sessions: num, activeUsers: num }).strict()).max(20),
    landing: z.array(z.object({ ...key, sessions: num, engagedSessions: num, engagementRate: num, keyEvents: num.nullable() }).strict()).max(20),
    pages: z.array(z.object({ ...key, screenPageViews: num, activeUsers: num, userEngagementDuration: num }).strict()).max(20),
    events: z.array(z.object({ ...key, eventCount: num, keyEvents: num.nullable() }).strict()).max(20),
    totals: z.object({ channels: z.record(z.string(),num).nullable(), landing: z.record(z.string(),num).nullable(),
      pages: z.record(z.string(),num).nullable(), events: z.record(z.string(),num).nullable() }).strict(),
  }).strict(),
  failedQueries: z.array(z.object({ report: z.enum(['channels','sourceMedium','landing','pages','events']), code: errorCode }).strict()).max(5),
}).strict();
export type ConsultingGa4 = z.infer<typeof ga4ConsultingSchema>;
