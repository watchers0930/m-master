import type { ConsultingSnapshot, ConsultingSectionsDTO } from "@/types/consulting";
import { sectionMeta, keywordCurrency } from "./meta";
export function keywordsSection(snapshot: ConsultingSnapshot): ConsultingSectionsDTO["keywords"] {
  const all = snapshot.structuredMetrics?.keywords ?? [];
  const meta = sectionMeta(snapshot,all.flatMap(k=>k.evidenceIds),all.some(k=>[k.difficulty,k.volume,k.cpc,k.rank].some(v=>v!==null)));
  meta.currency = keywordCurrency(snapshot);
  return {meta,rows:all.map(({evidenceIds:_,currency:_currency,...k})=>k)
    .sort((a,b)=>a.keywordId.localeCompare(b.keywordId))};
}
