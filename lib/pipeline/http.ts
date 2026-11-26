import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCronSecret } from '@/lib/cron/auth';
import { jsonError,queryParams,VisibilityError } from '@/lib/visibility/http';
import { assertAutomationEnabled } from './automation';
import { assessResult, cronName, outcomeOf, recordCronRun } from '@/lib/cron/heartbeat';
export async function pipelineRequest(request:NextRequest, ownerKey:'owner_id'|'ownerId'|null,
  work:(ownerId?:string)=>Promise<unknown>) {
  let authed=false;
  try {
    if (!verifyCronSecret(request)) throw new VisibilityError('unauthorized','인증이 필요합니다.',401);
    authed=true;
    assertAutomationEnabled();
    const params=queryParams(request);
    const input=ownerKey ? z.object({ [ownerKey]:z.string().min(1).max(200).optional() }).strict().parse(params) : z.object({}).strict().parse(params);
    const result=await work(ownerKey ? input[ownerKey] : undefined);
    const assessed=assessResult(result);
    await recordCronRun(cronName(request),assessed.outcome,assessed.code);
    return NextResponse.json(result);
  } catch(error) {
    if (authed) { const o=outcomeOf(error); await recordCronRun(cronName(request),o.outcome,o.code); }
    return jsonError(error);
  }
}
