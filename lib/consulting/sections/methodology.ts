import type { ConsultingSnapshot, ConsultingSectionsDTO } from "@/types/consulting";
import { sectionMeta } from "./meta";
export function methodologySection(snapshot: ConsultingSnapshot): ConsultingSectionsDTO["methodology"] {
  const defs = [
    ["difficulty","자연검색 상위 결과 진입 난이도 (광고 경쟁도와 별개)","kw_difficulty",null],
    ["demandVolume","선택 키워드의 월별 수요 관측 검색량 (결측은 0 아님)","kw_demand",null],
    ["volume","광고 관측의 검색량. 월별 수요와 별도 출처·기준 기간입니다.","kw_ads",null],
    ["cpc","관측 클릭당 비용 (통화 미확정 시 금액 집계 불가)","kw_ads",null],
    ["adValue","같은 광고 관측의 검색량 × CPC 참고값. 실광고비·매출·ROAS 아님. 반올림 없음.","kw_ads","volume * cpc"],
  ];
  const metrics = snapshot.structuredMetrics;
  const used = new Set<string>();
  if (metrics?.demand.length) used.add("kw_demand");
  if (metrics?.keywords.some(k=>k.difficulty!==null)) used.add("kw_difficulty");
  if (metrics?.keywords.some(k=>[k.volume,k.cpc,k.adCompetition,k.adValue].some(v=>v!==null))) used.add("kw_ads");
  return {meta:sectionMeta(snapshot,[],used.size>0),metricDefs:defs.filter(d=>used.has(d[2]!)).map(([key,definition,source,formula])=>
    ({key:key!,definition:definition!,source:source!,formula,version:"v2"})),selectionLimits:snapshot.selection.map(({source:_,...s})=>s)};
}
