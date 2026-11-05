import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { createContentRecord } from './writer';
export type GenerationClaim = { id:string; attempts:number; planItemId:string };
export type GenerationCost = { kind:'chat'|'embedding'|'image'|'external'; krw:number; tokensIn:number; tokensOut:number };
/** recordGenerationCosts로 이미 원장에 기록된 비용. persist 시 생성된 콘텐츠에 연결만 한다. */
export type RecordedCost = { ledgerId:string };
/**
 * 유료 응답 직후 비용을 즉시 원장에 기록한다(콘텐츠 미연결). persist 전에 플랫폼 시간초과로 죽어도
 * 이미 지불된 비용은 남아 한도 계산에 반영된다(topics service와 같은 원칙). persist 성공 시 contentId가 연결된다.
 */
export async function recordGenerationCosts(ownerId:string,costs:GenerationCost[]):Promise<RecordedCost[]> {
  const rows=costs.filter(cost=>cost.krw>0 || cost.tokensIn>0 || cost.tokensOut>0);
  if (!rows.length) return [];
  const created=await prisma.costLedger.createManyAndReturn({ data:rows.map(cost=>({...cost,ownerId})),select:{id:true} });
  return created.map(row=>({ ledgerId:row.id }));
}
/** Generated content, its incurred costs and pipeline completion commit together. */
export async function persistGeneratedContent(input:Parameters<typeof createContentRecord>[1],costs:(GenerationCost|RecordedCost)[],claim?:GenerationClaim,audit?:{ action:string; payload?:Prisma.InputJsonObject }) {
  return prisma.$transaction(async tx=>{
    if (claim) {
      await tx.$queryRaw`SELECT id FROM pipeline_runs WHERE id=${claim.id} AND owner_id=${input.ownerId} FOR UPDATE`;
      const current=await tx.pipelineRun.findFirst({ where:{ id:claim.id,ownerId:input.ownerId,attempts:claim.attempts,
        kind:'content_item',scopeKey:claim.planItemId,status:'running',leaseUntil:{gt:new Date()} },select:{id:true} });
      if (!current) throw new Error('generation_lease_lost');
      const item=await tx.contentPlanItem.findFirst({ where:{ id:claim.planItemId,plan:{ownerId:input.ownerId} },select:{contentJobId:true} });
      if (!item || item.contentJobId) throw new Error('generation_item_already_completed');
    }
    const content=await createContentRecord(tx,input);
    const recorded=costs.filter((cost):cost is RecordedCost=>'ledgerId' in cost).map(cost=>cost.ledgerId);
    const fresh=costs.filter((cost):cost is GenerationCost=>!('ledgerId' in cost));
    if (recorded.length) await tx.costLedger.updateMany({ where:{ id:{ in:recorded },ownerId:input.ownerId,contentId:null },data:{ contentId:content.id } });
    if (fresh.length) await tx.costLedger.createMany({ data:fresh.map(cost=>({...cost,ownerId:input.ownerId,contentId:content.id})) });
    if (claim) {
      const changed=await tx.contentPlanItem.updateMany({where:{ id:claim.planItemId,plan:{ownerId:input.ownerId},contentJobId:null,status:'generating' },
        data:{status:'generated',contentJobId:content.id,generatedAt:new Date()} });
      if (!changed.count) throw new Error('generation_item_changed');
      await tx.pipelineRun.updateMany({where:{id:claim.id,ownerId:input.ownerId,attempts:claim.attempts,status:'running'},
        data:{status:'succeeded',finishedAt:new Date(),resultRef:{contentId:content.id}} });
    }
    await tx.auditLog.create({ data:{ actor:input.ownerId, action:audit?.action ?? 'content.generate',
      targetType:'content',targetId:content.id,payload:audit?.payload ?? { channel:input.channel,cost_krw:input.costKrw ?? 0 } } });
    return content;
  });
}
