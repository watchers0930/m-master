import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCronSecret } from '@/lib/cron/auth';
import { jsonError,queryParams,VisibilityError } from '@/lib/visibility/http';
export async function pipelineRequest(request:NextRequest, ownerKey:'owner_id'|'ownerId'|null,
  work:(ownerId?:string)=>Promise<unknown>) {
  try {
    if (!verifyCronSecret(request)) throw new VisibilityError('unauthorized','인증이 필요합니다.',401);
    if (process.env.PIPELINE_AUTOMATION_ENABLED!=='true') throw new VisibilityError('automation_paused','자동화가 정지되어 있습니다.',503);
    const params=queryParams(request);
    const input=ownerKey ? z.object({ [ownerKey]:z.string().min(1).max(200).optional() }).strict().parse(params) : z.object({}).strict().parse(params);
    return NextResponse.json(await work(ownerKey ? input[ownerKey] : undefined));
  } catch(error) { return jsonError(error); }
}
