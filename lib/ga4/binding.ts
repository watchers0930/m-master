import { z } from 'zod';
import { prisma } from '@/lib/prisma';
// errors (not http): this module also runs from the operator CLI (scripts/ga4/bind.ts) outside Next.
import { VisibilityError } from '@/lib/visibility/errors';
import { runGa4 } from './run';
import { invalidateGa4Credentials } from './auth';
import { normalizeGa4Host } from './host';
const bindingSchema=z.object({ owner:z.string().min(1).max(200),domain:z.string().min(1).max(200),
  stream:z.string().regex(/^\d+$/).nullable().optional(),property:z.string().regex(/^\d+$/),sources:z.array(z.enum(['service_account','owner_oauth','env_oauth','legacy_file'])).min(1).max(4).default(['service_account']),
  events:z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)).max(10).default([]),verify:z.boolean().default(false),disable:z.boolean().default(false),
}).strict();
/** Operator-only entry point, deliberately not exposed over HTTP. */
export async function bindGa4(raw: unknown) {
  const input=bindingSchema.parse(raw);
  const domain=await prisma.domain.findFirst({ where:{ id:input.domain,ownerId:input.owner },select:{ url:true } });
  if (!domain) throw new VisibilityError('not_found','대상을 찾을 수 없습니다.',404);
  // Stored as the apex form; the shared run filter matches apex and www. (lib/ga4/host.ts).
  const host=normalizeGa4Host(new URL(domain.url.includes('://') ? domain.url : 'https://'+domain.url).hostname);
  const binding=await prisma.ga4Binding.upsert({ where:{ domainId:input.domain },create:{
    ownerId:input.owner,domainId:input.domain,host,streamId:input.stream ?? null,propertyId:'properties/'+input.property,allowedSources:input.sources,conversionEvents:input.events,
    status:input.disable?'disabled':'pending',
  },update:{ host,streamId:input.stream ?? null,propertyId:'properties/'+input.property,allowedSources:input.sources,conversionEvents:input.events,
    status:input.disable?'disabled':'pending',lastErrorCode:null,lastCheckedAt:null } });
  invalidateGa4Credentials(input.owner);
  if (input.verify && !input.disable) {
    const result=await runGa4({ ownerId:input.owner,domainId:input.domain,bindingId:binding.id,propertyId:binding.propertyId,
      host,streamId:binding.streamId,allowedSources:input.sources,conversionEvents:input.events },'binding-verify-v1',{ startDate:'7daysAgo',endDate:'yesterday' },async(client,property)=>{
        await client.runReport({ property,dateRanges:[{ startDate:'7daysAgo',endDate:'yesterday' }],metrics:[{ name:'sessions' }],limit:1 });
        return true;
      },0);
    await prisma.ga4Binding.updateMany({ where:{ id:binding.id,ownerId:input.owner },data:{
      status:result.status==='success'?'verified':'error',lastCheckedAt:new Date(),
      lastErrorCode:result.status==='error'?result.code:result.status==='unavailable'?'invalid_credentials':null,
    } });
  }
  await prisma.auditLog.create({ data:{ actor:'operator-cli',action:'ga4.binding_upsert',targetType:'ga4_binding',targetId:binding.id,
    payload:{ owner_id:input.owner,domain_id:input.domain,property_id:binding.propertyId,host } } });
  return { bindingId:binding.id };
}
