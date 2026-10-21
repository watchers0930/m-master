import type { ConsultingSnapshot, ConsultingSectionsDTO, StructuredMetrics } from "@/types/consulting";
import { snapshotHash } from "../hash";
import { sectionMeta, keywordCurrency } from "./meta";

/** Resolve each metric independently; a row-level reference is not proof of every value. */
function verifiedKeyword(snapshot: ConsultingSnapshot, row: StructuredMetrics["keywords"][number]) {
  const linked = snapshot.evidence.filter(e => row.evidenceIds.includes(e.id) && e.source === "seo");
  const evidenceIds: string[] = [];
  const metricPeriods: NonNullable<ConsultingSectionsDTO["focus"]["items"][number]["metricPeriods"]> = {};
  function metric<K extends "difficulty"|"volume"|"cpc"|"adCompetition"|"adValue"|"currency">(key: K): StructuredMetrics["keywords"][number][K] | null {
    const value = row[key];
    if (value === null) return null;
    const evidence = linked.find(e => e.id.endsWith(`_${key}`) && e.value === value);
    if (!evidence) return null;
    const base = evidence.id.slice(0, -key.length - 1);
    const source = linked.find(e => e.id === `${base}_source`);
    const [operation, task, audit, location] = String(source?.value ?? "").split("/");
    if (operation !== (key === "difficulty" ? "kw_difficulty" : "kw_ads") || !task || !audit ||
        location !== String(snapshot.structuredMetrics?.location) ||
        base !== `metric_${snapshotHash({task,keyword:row.keywordId}).slice(0,24)}`) return null;
    evidenceIds.push(evidence.id, source!.id);
    if (key !== "difficulty" && key !== "currency") {
      const period = linked.find(e => e.id === `${base}_period` && row.period && e.value === `${row.period.from}/${row.period.to}`);
      // Search volume describes the ads monthly series; CPC is a point-in-time observation.
      const observedPeriod = evidence.rangeFrom && evidence.rangeTo ? {from:evidence.rangeFrom,to:evidence.rangeTo} :
        key === "volume" || key === "adValue" ? period ? row.period : null :
        evidence.observedAt ? {from:evidence.observedAt,to:evidence.observedAt} : null;
      if (observedPeriod) metricPeriods[key as keyof typeof metricPeriods] = observedPeriod;
      if (period && (key === "volume" || key === "adValue")) evidenceIds.push(period.id);
    }
    return value;
  }
  const difficulty=metric("difficulty"), volume=metric("volume"), cpc=metric("cpc"), adCompetition=metric("adCompetition");
  const currency=metric("currency");
  const candidate=metric("adValue");
  const adValue=volume !== null && cpc !== null && currency !== null && candidate === volume*cpc ? candidate : null;
  if (adValue === null) delete metricPeriods.adValue;
  return {...row,difficulty,volume,cpc,adCompetition,adValue,currency,evidenceIds:[...new Set(evidenceIds)].sort(),metricPeriods};
}
export function focusSection(snapshot: ConsultingSnapshot): ConsultingSectionsDTO["focus"] {
  const rows = (snapshot.structuredMetrics?.keywords ?? []).map(row=>verifiedKeyword(snapshot,row));
  const items = rows.map(({keywordId,difficulty,volume,cpc,adCompetition,adValue,evidenceIds,metricPeriods})=>
    ({keywordId,difficulty,volume,cpc,adCompetition,adValue,evidenceIds,metricPeriods})).sort((a,b)=>a.keywordId.localeCompare(b.keywordId));
  const meta = sectionMeta(snapshot,items.flatMap(i=>i.evidenceIds),items.some(i=>[i.difficulty,i.volume,i.cpc].some(v=>v!==null)));
  meta.currency = keywordCurrency({...snapshot,structuredMetrics:snapshot.structuredMetrics ? {...snapshot.structuredMetrics,keywords:rows} : undefined});
  return {meta,items};
}
