import type { ConsultingSnapshot, ConsultingSectionsDTO } from "@/types/consulting";
import { sectionMeta } from "./meta";
export function summarySection(snapshot: ConsultingSnapshot): ConsultingSectionsDTO["summary"] {
  const points = snapshot.structuredMetrics?.demand ?? [];
  const groups = new Map<string, typeof points>();
  for (const point of points) {
    const key = `${point.year}-${String(point.month).padStart(2,"0")}:${point.location}`;
    const group = groups.get(key) ?? [];
    if (group.some(p => p.keywordId === point.keywordId)) throw new Error("duplicate_demand_evidence");
    group.push(point); groups.set(key,group);
  }
  const monthly = [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([, rows]) => {
    const p = rows[0], id = `demand_sum_${p.location}_${p.year}_${p.month}`;
    const value = rows.reduce((n,r)=>n+r.volume,0);
    const existing = snapshot.evidence.find(e => e.id === id);
    if (!existing) snapshot.evidence.push({id, source:"seo", label:"선택 키워드 검색량 부분합 (중복제거 시장규모 아님)", value,
      unit:"searches", observedAt: sectionMeta(snapshot,rows.map(r=>r.evidenceId),true).observedAt});
    else if (existing.value !== value) throw new Error("inconsistent_demand_sum");
    return {location:p.location,year:p.year,month:p.month,volume:value,evidenceId:id};
  });
  const observedMonths = [...new Set(monthly.map(p=>`${p.year}-${String(p.month).padStart(2,"0")}`))].sort();
  const period = snapshot.structuredMetrics?.period, missingMonths: string[] = [];
  if (period) {
    const from = new Date(period.from), to = new Date(period.to);
    for (let date=from; date<=to; date=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1))) {
      const month=date.toISOString().slice(0,7);
      if (!observedMonths.includes(month)) missingMonths.push(month);
    }
  }
  const meta = sectionMeta(snapshot,[...points.map(p=>p.evidenceId),...monthly.map(p=>p.evidenceId)],monthly.length>0,"searches");
  const n = snapshot.structuredMetrics?.keywords.length ?? 0;
  meta.coverage = n && (observedMonths.length+missingMonths.length) ? points.length/(n*(observedMonths.length+missingMonths.length)) : null;
  return {meta, monthly, observedMonths, missingMonths};
}
