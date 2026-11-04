import { z } from 'zod';
/** Stored ContentPlanItem/Content.strategyContext (JSON). Bounds are generous; boundStrategyContext trims. */
const text = (max: number) => z.string().max(max);
export const strategyContextSchema = z.object({
  v: z.literal(1), reportId: z.string().min(1).max(200), actionId: z.string().min(1).max(200),
  priority: z.enum(['P0', 'P1', 'P2']), actionTitle: text(2000), actionDescription: text(8000),
  evidence: z.array(z.object({ id: text(200), label: text(2000), value: text(2000) }).strict()).max(100),
  range: z.object({ from: text(40), to: text(40) }).strict(), limitations: z.array(text(2000)).max(50),
  truncated: z.boolean().optional(),
}).strict();
export type StrategyContext = z.infer<typeof strategyContextSchema>;
