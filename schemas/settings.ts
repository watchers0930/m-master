import { z } from 'zod';
const object = z.record(z.string().max(100), z.json()).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 65536);
export const settingsSchema = z.object({
  brand_guide: object.optional(), prompt_templates: z.record(z.string().max(100), z.string().max(20000)).optional(),
  budget_monthly: z.number().int().min(0).max(10000000000).optional(),
  alert_threshold: z.number().min(0).max(1).optional(), notifications: object.optional(),
  automation_domain_id: z.string().min(1).max(200).nullable().optional(),
}).strict();
