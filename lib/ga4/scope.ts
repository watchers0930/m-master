import { prisma } from '@/lib/prisma';
import type { Ga4Scope, Ga4UnavailableReason, Ga4CredentialSource } from '@/types/ga4';
import { ga4HostVariants, normalizeGa4Host } from './host';
export type ScopeResult = { ok: true; scope: Ga4Scope } | { ok: false; reason: Ga4UnavailableReason };
const select = { streamId:true,id:true,domainId:true,propertyId:true,host:true,allowedSources:true,conversionEvents:true,status:true } as const;
type Binding = { streamId?:string|null; id:string;domainId:string;propertyId:string;host:string;allowedSources:string[];conversionEvents:string[];status:string };
function result(ownerId:string,binding:Binding):ScopeResult {
  if (binding.status==='disabled') return {ok:false,reason:'binding_disabled'};
  return {ok:true,scope:{ownerId,domainId:binding.domainId,bindingId:binding.id,propertyId:binding.propertyId,
    host:binding.host,streamId:binding.streamId,allowedSources:binding.allowedSources as Ga4CredentialSource[],conversionEvents:binding.conversionEvents}};
}
export async function resolveGa4Scope(ownerId: string, domainId?: string): Promise<ScopeResult> {
  if (domainId) {
    const domain=await prisma.domain.findFirst({where:{id:domainId,ownerId},select:{id:true}});
    if (!domain) return {ok:false,reason:'unmapped'};
    const binding=await prisma.ga4Binding.findFirst({where:{ownerId,domainId,domain:{ownerId}},select});
    return binding ? result(ownerId,binding) : {ok:false,reason:'unmapped'};
  }
  const setting=await prisma.setting.findUnique({where:{ownerId},select:{automationDomainId:true}});
  if (setting?.automationDomainId) {
    const binding=await prisma.ga4Binding.findFirst({where:{ownerId,domainId:setting.automationDomainId,domain:{ownerId}},select});
    if (binding) return result(ownerId,binding);
  }
  const bindings=await prisma.ga4Binding.findMany({where:{ownerId,status:'verified',domain:{ownerId}},select,take:2});
  if (bindings.length>1) return {ok:false,reason:'domain_required'};
  if (!bindings.length) return {ok:false,reason:'not_configured'};
  return result(ownerId,bindings[0]);
}

/** A/B variants must map to one verified, owned host, never the automation default. */
export async function resolveGa4UrlScope(ownerId: string, urls: (string | null | undefined)[]): Promise<ScopeResult> {
  if (!ownerId || urls.length !== 2) return { ok: false, reason: 'unmapped' };
  let hosts: string[];
  try {
    hosts = urls.map(value => {
      const url = new URL(value ?? '');
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('invalid_url');
      return normalizeGa4Host(url.hostname);
    });
  } catch { return { ok: false, reason: 'unmapped' }; }
  if (hosts[0] !== hosts[1]) return { ok: false, reason: 'unmapped' };
  const bindings = await prisma.ga4Binding.findMany({
    // Legacy bindings may still store the www. form; both forms denote the same GA4 host scope.
    where: { ownerId, host: { in: ga4HostVariants(hosts[0]) }, status: 'verified', domain: { ownerId } }, select, take: 2,
  });
  return bindings.length === 1 ? result(ownerId, bindings[0]) : { ok: false, reason: 'unmapped' };
}
