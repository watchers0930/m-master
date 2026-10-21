import { Prisma, type SeoTask } from "@prisma/client";
import { checkpointSchema, type Checkpoint, type FrozenInput } from "./adapters/types";
import { metricInput, normalizeMetricKeyword } from "./adapters/metric-contract";

/** Owner lock required. Batch writes; audit creation order fences delayed workers. */
export async function writeMetricCheckpoint(tx: Prisma.TransactionClient, task: SeoTask, raw: Checkpoint) {
  const result = checkpointSchema.parse(raw), input = task.frozenInput as unknown as FrozenInput;
  metricInput(input);
  if (result.metrics.length || result.observations.length || result.pages.length ||
      (task.operation !== "kw_difficulty" && result.difficulties.length) ||
      (task.operation !== "kw_ads" && result.adsMetrics.length) ||
      (task.operation !== "kw_demand" && result.demandPoints.length)) throw new Error("metric_operation_mismatch");
  const audit = await tx.seoAudit.findFirst({where: {id: task.auditId, market: input.market, domain: {ownerId: task.ownerId}},
    select: {id: true, domainId: true, market: true, createdAt: true}});
  if (!audit) throw new Error("invalid_metric_owner");
  const keywords = await tx.seoKeyword.findMany({where: {id: {in: input.keywordIds}, domainId: audit.domainId,
    market: audit.market, engine: "google", domain: {ownerId: task.ownerId}}, select: {id: true, normalizedKeyword: true}});
  if (keywords.length !== input.keywordIds!.length) throw new Error("invalid_metric_keywords");
  const ids = new Map(keywords.map(k => [k.normalizedKeyword,k.id]));
  if (input.keywordIds!.some((id,i) => ids.get(input.keywords![i]) !== id)) throw new Error("invalid_metric_mapping");
  const key = (keyword: string) => {
    const id = ids.get(normalizeMetricKeyword(keyword));
    if (!id) throw new Error("unexpected_metric_keyword");
    return id;
  };
  const data = task.operation === "kw_difficulty" ? result.difficulties.map(r => ({id: key(r.keyword), difficulty: r.difficulty})) :
    task.operation === "kw_ads" ? result.adsMetrics.map(r => ({id: key(r.keyword), cpc: r.cpc, adCompetition: r.adCompetition,
      adValue: ["KRW","USD","GBP","CAD","AUD"].includes(r.currency ?? "") && r.monthly.length > 0 && r.searchVolume !== null && r.cpc !== null && Number.isFinite(r.searchVolume*r.cpc) ? r.searchVolume*r.cpc : null})) : [];
  if (data.length) {
    // Compare the latest applied checkpoint for this operation, not shared metricsUpdatedAt/lastAuditId.
    // Current transaction updates task status only after this writer completes.
    const condition = Prisma.sql`NOT EXISTS (
      SELECT 1 FROM seo_tasks newer JOIN seo_audits a ON a.id=newer.audit_id
      WHERE newer.operation=${task.operation} AND newer.status IN ('completed','partial')
      AND a.domain_id=${audit.domainId} AND a.market=${audit.market}
      AND newer.frozen_input @> jsonb_build_object('keywordIds', jsonb_build_array(k.id))
      AND (a.created_at > ${audit.createdAt} OR (a.created_at=${audit.createdAt} AND a.id > ${audit.id})))`;
    const rows = JSON.stringify(data);
    if (task.operation === "kw_difficulty") await tx.$executeRaw`
      UPDATE seo_keywords k SET difficulty=v.difficulty FROM jsonb_to_recordset(${rows}::jsonb) AS v(id text,difficulty integer)
      WHERE k.id=v.id AND k.domain_id=${audit.domainId} AND k.market=${audit.market} AND k.engine='google' AND ${condition}`;
    else await tx.$executeRaw`
      UPDATE seo_keywords k SET cpc=v.cpc, ad_competition=v."adCompetition", ad_value=v."adValue"
      FROM jsonb_to_recordset(${rows}::jsonb) AS v(id text,cpc double precision,"adCompetition" text,"adValue" double precision)
      WHERE k.id=v.id AND k.domain_id=${audit.domainId} AND k.market=${audit.market} AND k.engine='google' AND ${condition}`;
  }
  if (task.operation !== "kw_demand" || !result.demandPoints.length) return;
  const points = result.demandPoints.map(p => {
    if (p.location !== input.location) throw new Error("invalid_metric_location");
    const period = input.targetPeriod, index = p.year*12+p.month;
    if (!period || index < period.fromYear*12+period.fromMonth || index > period.toYear*12+period.toMonth) throw new Error("invalid_metric_period");
    return {...p, keywordId: key(p.keyword)};
  });
  if (new Set(points.map(p => `${p.keywordId}:${p.location}:${p.year}:${p.month}`)).size !== points.length) throw new Error("duplicate_metric_month");
  await tx.$executeRaw`
    INSERT INTO seo_demand_points (id,domain_id,keyword_id,market,location,year,month,volume,audit_id)
    SELECT ${task.id} || ':' || v."keywordId" || ':' || v.year || ':' || v.month,
      ${audit.domainId},v."keywordId",${audit.market},v.location,v.year,v.month,v.volume,${audit.id}
    FROM jsonb_to_recordset(${JSON.stringify(points)}::jsonb) AS v("keywordId" text,location integer,year integer,month integer,volume integer)
    ON CONFLICT (keyword_id,location,year,month) DO UPDATE SET volume=EXCLUDED.volume,audit_id=EXCLUDED.audit_id
    WHERE EXISTS (SELECT 1 FROM seo_audits old WHERE old.id=seo_demand_points.audit_id
      AND (old.created_at < ${audit.createdAt} OR (old.created_at=${audit.createdAt} AND old.id <= ${audit.id})))`;
}
