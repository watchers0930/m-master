import type { ConsultingSnapshot, ConsultingSectionsDTO } from "@/types/consulting";
import { sectionMeta } from "./meta";
export function competitorsSection(snapshot: ConsultingSnapshot): ConsultingSectionsDTO["competitors"] {
  const items = snapshot.evidence.filter(e=>e.source==="geo" && e.id.startsWith("geo_competitor_") && typeof e.value === "number")
    .map(e=>({source:"geo" as const,name:e.label.replace(/^Untrusted competitor label: /,""),metric:"mentionRate",value:e.value as number,evidenceId:e.id})).sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId));
  const meta = sectionMeta(snapshot,items.map(i=>i.evidenceId),items.length>0);
  meta.location=null; meta.period=snapshot.range;
  meta.reason="GEO 언급 근거만 제공하며 SERP 경쟁 지도는 준비 필요합니다.";
  return {meta,items:items.length ? items : null};
}
