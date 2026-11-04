import { expireClaims } from '@/lib/publish/claims';
import { prisma } from '@/lib/prisma';
import { publishContentNow,publishIdeaJob } from '@/lib/publish/service';
import { deriveCafeContent } from '@/lib/publish/derive';
import { VisibilityError } from '@/lib/visibility/errors';
import { pipelineOwners } from './owners';
import type { Channel } from '@/types/db';
export async function publishScheduledContent(deadline=Date.now()+240000) {
  const result={ ok:true,social:[] as Record<string,unknown>[],cafe:[] as Record<string,unknown>[],idea_jobs:[] as Record<string,unknown>[],held:0,deadline_hit:false };
  await expireClaims();
  const cutoff = new Date();
  for await (const owner of pipelineOwners()) {
    if (Date.now()+30000>=deadline) { result.deadline_hit=true;break; }
    let cursor: { scheduledAt: Date; id: string } | undefined;
    while (Date.now()+30000 < deadline) {
      const slots=await prisma.scheduleSlot.findMany({ where:{ ownerId:owner.ownerId,status:'scheduled',scheduledAt:{ lte:cutoff }, ...(cursor ? { OR: [{ scheduledAt:{ gt:cursor.scheduledAt,lte:cutoff } },{ scheduledAt:cursor.scheduledAt,id:{ gt:cursor.id } }] } : {}) },
        select:{ id:true,contentId:true,channel:true,scheduledAt:true },orderBy:[{ scheduledAt:'asc' },{ id:'asc' }],take:20 });
      for (const slot of slots) {
        if (Date.now()+30000>=deadline) { result.deadline_hit=true;break; }
        if (!slot.contentId) continue;
        try {
          if (slot.channel==='blog') {
            const derived=await deriveCafeContent(owner.ownerId,slot.contentId);
            result.cafe.push({ slot_id:slot.id,...derived });
            continue;
          }
          const sent=await publishContentNow({ ownerId:owner.ownerId,contentId:slot.contentId,channel:slot.channel as Channel,trigger:'schedule',scheduleSlotId:slot.id });
          await prisma.scheduleSlot.updateMany({ where:{ id:slot.id,ownerId:owner.ownerId,status:'scheduled' },data:{
            status:'published',publishedAt:new Date(),externalId:sent.externalId,externalUrl:sent.externalUrl } });
          result.social.push({ slot_id:slot.id,status:'published' });
        } catch(error) {
          if (error instanceof VisibilityError && error.status===409) result.held++;
          else result.social.push({ slot_id:slot.id,status:'failed' });
        }
      }
      if (result.deadline_hit || slots.length < 20) break;
      const last = slots[slots.length-1];
      cursor = { scheduledAt:last.scheduledAt,id:last.id };
    }
    const children=await prisma.content.findMany({ where:{ ownerId:owner.ownerId,origin:'auto',reviewStatus:'approved',status:'draft',
      parentContentId:{ not:null },channel:{ in:['naver_cafe','facebook','instagram'] } },
      select:{ id:true,channel:true },orderBy:[{ reviewedAt:'asc' },{ createdAt:'asc' }],take:20 });
    const channels=new Set<string>();
    for (const child of children) {
      if (Date.now()+30000>=deadline) { result.deadline_hit=true;break; }
      if (channels.has(child.channel)) continue;
      try {
        await publishContentNow({ ownerId:owner.ownerId,contentId:child.id,channel:child.channel as Channel,trigger:'schedule',dailyLimit:true });
        channels.add(child.channel);
        result.cafe.push({ content_id:child.id,status:'published' });
      } catch(error) {
        if (error instanceof VisibilityError && ['not_due','publish_in_progress'].includes(error.code)) channels.add(child.channel);
        result.held++;
      }
    }
    const jobs=await prisma.ideaPublishJob.findMany({ where:{ ownerId:owner.ownerId,status:'pending',scheduledAt:{ lte:new Date() },
      channel:{ in:['naver_cafe','facebook','instagram'] } },select:{ id:true },orderBy:{ scheduledAt:'asc' },take:20 });
    for (const job of jobs) {
      if (Date.now()+30000>=deadline) { result.deadline_hit=true;break; }
      try { await publishIdeaJob(owner.ownerId,job.id);result.idea_jobs.push({ id:job.id,status:'done' }); }
      catch(error) { if (error instanceof VisibilityError && error.status===409) result.held++;else result.idea_jobs.push({ id:job.id,status:'failed' }); }
    }
  }
  return result;
}
