import { z } from 'zod';
export const ga4QuerySchema = z.object({ domain_id: z.string().min(1).max(200).optional() }).strict();
export const visitorsQuerySchema = ga4QuerySchema.extend({ period: z.enum([
  'today', 'yesterday', 'this_week', 'this_month', '7d', '30d', '90d', '365d',
]).default('30d') }).strict();
export const performanceQuerySchema = ga4QuerySchema.extend({ days: z.coerce.number().int().min(1).max(90).default(30) }).strict();
