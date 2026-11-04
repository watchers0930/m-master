import { z } from 'zod';
export const workerClaimSchema = z.object({
  contentId: z.string().min(1).max(200), claimToken: z.string().min(32).max(200),
}).strict();
export const workerCompleteSchema = workerClaimSchema.extend({
  externalUrl: z.url().refine(value => {
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname) && url.pathname.length > 1;
  }),
}).strict();
export const workerFailSchema = workerClaimSchema.extend({
  outcome: z.enum(['not_posted', 'unknown']), error: z.string().max(500),
}).strict();
