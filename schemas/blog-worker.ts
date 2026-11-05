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
  outcome: z.enum(['not_posted', 'unknown']),
  // 사유 코드만 허용(예: session_expired·captcha_required). 쿠키·HTML·자유 문장이 저장되지 않도록 형식을 강제한다.
  error: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
}).strict();
