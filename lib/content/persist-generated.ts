import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { createContentRecord } from './writer';
export type GenerationClaim = { id:string; attempts:number; planItemId:string };
export type GenerationCost = { kind:'chat'|'embedding'|'image'|'external'; krw:number; tokensIn:number; tokensOut:number };
/** Generated content, its incurred costs and pipeline completion commit together. */
export async function persistGeneratedContent(input:Parameters<typeof createContentRecord>[1],costs:GenerationCost[],claim?:GenerationClaim,audit?:{ action:string; payload?:Prisma.InputJsonObject }) {
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
    await tx.costLedger.createMany({ data:costs.map(cost=>({...cost,ownerId:input.ownerId,contentId:content.id})) });
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
