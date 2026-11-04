import { z } from 'zod';
const id = z.string().min(1).max(200);
export const contentIdSchema = id;
export const contentListSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional(),
  channel: z.enum(['blog', 'instagram', 'facebook', 'naver_cafe']).optional(),
  review_status: z.enum(['pending_review', 'approved', 'rejected']).optional(),
  origin: z.enum(['manual', 'auto']).optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const contentEditSchema = z.object({
  expected_updated_at: z.iso.datetime({ offset: true }),
  topic: z.string().trim().min(1).max(500).optional(),
  text_body: z.string().max(50000).optional(),
  keywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
}).strict().refine(v => v.topic !== undefined || v.text_body !== undefined || v.keywords !== undefined);
export const contentReviewSchema = z.object({
  decision: z.enum(['approve', 'reject', 'request_review']),
  expected_updated_at: z.iso.datetime({ offset: true }),
  reason: z.string().max(500).optional(),
}).strict();
export type ContentEditInput = z.infer<typeof contentEditSchema>;
export type ContentReviewInput = z.infer<typeof contentReviewSchema>;
