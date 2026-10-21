import { Prisma, type SeoTask } from "@prisma/client";
import type { ConsultingSnapshot, StructuredMetrics, Currency } from "@/types/consulting";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { checkpointSchema, type FrozenInput } from "@/lib/seo/adapters/types";
import { METRIC_OPERATIONS } from "@/lib/seo/adapters/metric-contract";
import { snapshotHash } from "./hash";
/** Stored sources only, called inside the input collector's repeatable-read transaction. */
export async function readStructuredInput(tx: Prisma.TransactionClient, ownerId: string, domainId: string, snapshot: ConsultingSnapshot) {
  const location = MARKET_LOCATIONS[snapshot.market].location_code;
  const where = {domainId, market:snapshot.market, engine:"google", reservationOnly:false, domain:{ownerId}};
  const [keywords,total] = await Promise.all([
    tx.seoKeyword.findMany({where,select:{id:true,keyword:true,normalizedKeyword:true},
      orderBy:[{searchVolume:{sort:"desc",nulls:"last"}},{id:"asc"}],take:50}), tx.seoKeyword.count({where}),
  ]);
  const to = new Date(snapshot.range.to), end = new Date(Date.UTC(to.getUTCFullYear(),to.getUTCMonth(),0));
  const start = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-11,1));
  const period = {from:start.toISOString(),to:end.toISOString()};
  const result: StructuredMetrics = {keywords:[],demand:[],location,period};
  snapshot.selection.push({source:"structured_keywords",total,selected:keywords.length,limit:50,rule:"Google; exact searchVolume DESC NULLS LAST, id ASC; frozen twelve completed months"});
  if (!keywords.length) return result;
  const tasks = await tx.$queryRaw<Pick<SeoTask, "id"|"auditId"|"operation"|"frozenInput"|"resultCheckpoint">[]>(Prisma.sql`
    WITH candidates AS (
      SELECT k.id AS keyword_id, t.*, a.created_at AS audit_created_at
      FROM seo_keywords k JOIN seo_tasks t ON t.frozen_input @> jsonb_build_object('keywordIds', jsonb_build_array(k.id))
      JOIN seo_audits a ON a.id=t.audit_id JOIN domains d ON d.id=a.domain_id
      WHERE k.id IN (${Prisma.join(keywords.map(k=>k.id))}) AND k.domain_id=${domainId}
        AND t.owner_id=${ownerId} AND d.owner_id=${ownerId} AND a.domain_id=${domainId} AND a.market=${snapshot.market}
        AND t.operation IN (${Prisma.join([...METRIC_OPERATIONS])}) AND t.status IN ('completed','partial')
        AND a.created_at<=${to} AND t.result_checkpoint->>'observedAt'<=${snapshot.range.to}
        AND t.frozen_input->>'location'=${String(location)} AND t.frozen_input->>'market'=${snapshot.market}
    ), latest AS (
      SELECT DISTINCT ON (keyword_id, operation) * FROM candidates
      WHERE operation IN ('kw_difficulty','kw_ads')
      ORDER BY keyword_id, operation, audit_created_at DESC, audit_id DESC, id ASC
    ), selected AS (
      SELECT id, audit_id, operation, frozen_input, result_checkpoint, audit_created_at FROM latest
      UNION
      SELECT id, audit_id, operation, frozen_input, result_checkpoint, audit_created_at FROM candidates WHERE operation='kw_demand'
    )
    SELECT id, audit_id AS "auditId", operation, frozen_input AS "frozenInput", result_checkpoint AS "resultCheckpoint"
    FROM selected ORDER BY audit_created_at DESC, audit_id DESC, id ASC`);
  const add = (id: string, label: string, value: number|string|null, at: string, unit?:string) => {
    snapshot.evidence.push({id,source:"seo",label,value,observedAt:at,...(unit?{unit}:{})}); return id;
  };
  const parsed = tasks.flatMap(t=>{
    const p=checkpointSchema.safeParse(t.resultCheckpoint), i=t.frozenInput as unknown as FrozenInput;
    return p.success && p.data.observedAt<=snapshot.range.to && i.location===location && i.market===snapshot.market ? [{...t,input:i,checkpoint:p.data}] : [];
  });
  for (const k of keywords) {
    const row: StructuredMetrics["keywords"][number] = {keywordId:k.id,keyword:k.keyword,difficulty:null,volume:null,cpc:null,adCompetition:null,
      adValue:null,rank:null,rankSource:null,period:null,status:"missing",evidenceIds:[],currency:null};
    for (const operation of ["kw_difficulty","kw_ads"] as const) {
      const task = parsed.find(t=>t.operation===operation && t.input.keywordIds?.includes(k.id) &&
        t.input.keywords?.[t.input.keywordIds.indexOf(k.id)]===k.normalizedKeyword);
      if (!task) continue;
      const cp=task.checkpoint, id=`metric_${snapshotHash({task:task.id,keyword:k.id}).slice(0,24)}`;
      // Provenance freezes operation/task/audit/location/time independently of shared row timestamps.
      row.evidenceIds.push(add(`${id}_source`,"지표 출처·작업·감사·지역",`${operation}/${task.id}/${task.auditId}/${location}`,cp.observedAt));
      if (operation==="kw_difficulty") {
        row.difficulty=cp.difficulties.find(r=>r.keyword===k.normalizedKeyword)?.difficulty??null;
        row.evidenceIds.push(add(`${id}_difficulty`,"자연검색 난이도",row.difficulty,cp.observedAt,"score"));
      } else {
        const ads=cp.adsMetrics.find(r=>r.keyword===k.normalizedKeyword);
        if (!ads) continue;
        row.volume=ads.searchVolume; row.cpc=ads.cpc; row.adCompetition=ads.adCompetition;
        row.currency=(["KRW","USD","GBP","CAD","AUD"].includes(ads.currency??"") ? ads.currency : null) as Currency|null;
        const months=ads.monthly.map(m=>`${m.year}-${String(m.month).padStart(2,"0")}`).sort();
        row.period=months.length?{from:months[0],to:months.at(-1)!}:null;
        row.adValue=row.currency && row.period && row.volume!==null && row.cpc!==null && Number.isFinite(row.volume*row.cpc) ? row.volume*row.cpc : null;
        for (const name of ["volume","cpc","adCompetition","adValue","currency"] as const)
          row.evidenceIds.push(add(`${id}_${name}`,name,row[name],cp.observedAt));
        if(row.period) row.evidenceIds.push(add(`${id}_period`,"광고 검색량 기준 기간",`${row.period.from}/${row.period.to}`,cp.observedAt));
      }
    }
    result.keywords.push(row);
  }
  // One bounded batch read, no keyword-by-keyword queries. Direct SERP observations only.
  const rankings = await tx.$queryRaw<{id:string;keywordId:string;rank:number|null;status:string;capturedAt:Date}[]>(Prisma.sql`
    SELECT id, keyword_id AS "keywordId", rank, status, captured_at AS "capturedAt"
    FROM (SELECT DISTINCT ON (r.keyword_id) r.* FROM seo_rankings r
      JOIN seo_audits a ON a.id=r.audit_id JOIN domains d ON d.id=a.domain_id
      JOIN seo_keywords k ON k.id=r.keyword_id JOIN domains kd ON kd.id=k.domain_id
      WHERE r.domain_id=${domainId} AND r.market=${snapshot.market} AND r.engine='google' AND r.source='serp'
        AND r.keyword_id IN (${Prisma.join(keywords.map(k=>k.id))}) AND r.captured_at<=${to}
        AND d.owner_id=${ownerId} AND kd.owner_id=${ownerId}
      ORDER BY r.keyword_id, r.captured_at DESC, r.id ASC) latest
    ORDER BY captured_at DESC, id ASC LIMIT 50`);
  for (const row of result.keywords) {
    const r=rankings.find(r=>r.keywordId===row.keywordId);
    if (r && r.status==="ranked") {
      row.rank=r.rank; row.rankSource="serp";
      row.evidenceIds.push(add(`metric_rank_${r.id}`,"직접 SERP 관측 순위",r.rank,r.capturedAt.toISOString(),"position"));
    }
    const hasMetric = row.difficulty!==null || row.volume!==null || row.cpc!==null || row.rank!==null;
    row.status=hasMetric?"partial":"missing";
  }
  const points=await tx.seoDemandPoint.findMany({where:{domainId,market:snapshot.market,location,keywordId:{in:keywords.map(k=>k.id)},
    domain:{ownerId},keyword:{domainId,market:snapshot.market,engine:"google",domain:{ownerId}},
    audit:{domainId,market:snapshot.market,domain:{ownerId}},
    OR:[{year:start.getUTCFullYear(),month:{gte:start.getUTCMonth()+1}},{year:end.getUTCFullYear(),month:{lte:end.getUTCMonth()+1}}]},
    select:{keywordId:true,location:true,year:true,month:true,volume:true},orderBy:[{year:"asc"},{month:"asc"},{location:"asc"},{keywordId:"asc"}],take:601});
  if (points.length>600) throw new Error("structured_demand_limit");
  // Index exact provenance once; stored points must match keyword mapping and value.
  const keywordById = new Map(keywords.map(k => [k.id, k.normalizedKeyword]));
  const demandKey = (keywordId: string, location: number, year: number, month: number, volume: number) =>
    JSON.stringify([keywordId, location, year, month, volume]);
  const demandEvidence = new Map<string, (typeof parsed)[number]>();
  for (const task of parsed) {
    if (task.operation !== "kw_demand") continue;
    const keywordIds = new Map<string, string>();
    task.input.keywordIds?.forEach((id, index) => {
      const keyword = keywordById.get(id);
      if (keyword !== undefined && task.input.keywords?.[index] === keyword) keywordIds.set(keyword, id);
    });
    for (const point of task.checkpoint.demandPoints) {
      const keywordId = keywordIds.get(point.keyword);
      if (!keywordId) continue;
      const key = demandKey(keywordId, point.location, point.year, point.month, point.volume);
      if (!demandEvidence.has(key)) demandEvidence.set(key, task);
    }
  }
  for (const p of points) {
    if (!p.keywordId) continue;
    const index=p.year*12+p.month;
    if(index<start.getUTCFullYear()*12+start.getUTCMonth()+1 || index>end.getUTCFullYear()*12+end.getUTCMonth()+1) continue;
    const task = demandEvidence.get(demandKey(p.keywordId, p.location, p.year, p.month, p.volume));
    if (!task) { if(!snapshot.limitations.includes("일부 수요의 검증 가능한 작업 근거가 없어 제외했습니다.")) snapshot.limitations.push("일부 수요의 검증 가능한 작업 근거가 없어 제외했습니다."); continue; }
    const evidenceId=`demand_${snapshotHash({key:p.keywordId,location,year:p.year,month:p.month}).slice(0,24)}`;
    add(evidenceId,`kw_demand/${task.id}/${task.auditId}/${location}/${p.year}-${p.month}`,p.volume,task.checkpoint.observedAt,"searches");
    result.demand.push({keywordId:p.keywordId,location,year:p.year,month:p.month,volume:p.volume,evidenceId});
  }
  return result;
}
