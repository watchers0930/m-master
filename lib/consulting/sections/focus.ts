import type { ConsultingSnapshot, ConsultingSectionsDTO } from "@/types/consulting";
import { sectionMeta, keywordCurrency } from "./meta";
export function focusSection(snapshot: ConsultingSnapshot): ConsultingSectionsDTO["focus"] {
  const items = (snapshot.structuredMetrics?.keywords ?? []).map(({keywordId,difficulty,volume,cpc,adCompetition,adValue,evidenceIds})=>
    ({keywordId,difficulty,volume,cpc,adCompetition,adValue,evidenceIds})).sort((a,b)=>a.keywordId.localeCompare(b.keywordId));
  const meta = sectionMeta(snapshot,items.flatMap(i=>i.evidenceIds),items.some(i=>[i.difficulty,i.volume,i.cpc].some(v=>v!==null)));
  meta.currency = keywordCurrency(snapshot);
  return {meta,items};
}
