import type { ConsultingSnapshot, ConsultingSectionsDTO } from "@/types/consulting";
import { snapshotHash } from "../hash";
import { sectionMeta } from "./meta";
export function summarySection(snapshot: ConsultingSnapshot): {section: ConsultingSectionsDTO["summary"]; additionalEvidence: ConsultingSnapshot["evidence"]} {
  const additionalEvidence: ConsultingSnapshot["evidence"] = [];
  const points = (snapshot.structuredMetrics?.demand ?? []).filter(p => {
    const id = `demand_${snapshotHash({key:p.keywordId,location:p.location,year:p.year,month:p.month}).slice(0,24)}`;
    const evidence = snapshot.evidence.find(e => e.id === p.evidenceId);
    const label = evidence?.label.split("/");
    return p.evidenceId === id && evidence?.source === "seo" && evidence.unit === "searches" &&
      evidence.value === p.volume && label?.length === 5 && label[0] === "kw_demand" && !!label[1] && !!label[2] &&
      label[3] === String(p.location) && label[4] === `${p.year}-${p.month}`;
  });
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
    if (!existing) additionalEvidence.push({id, source:"seo", label:"선택 키워드 검색량 부분합 (중복제거 시장규모 아님)", value,
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
  const meta = sectionMeta({...snapshot,evidence:[...snapshot.evidence,...additionalEvidence]},[...points.map(p=>p.evidenceId),...monthly.map(p=>p.evidenceId)],monthly.length>0,"searches");
  const n = snapshot.structuredMetrics?.keywords.length ?? 0;
  meta.period = period ?? null;
  meta.coverage = n && (observedMonths.length+missingMonths.length) ? points.length/(n*(observedMonths.length+missingMonths.length)) : null;
  return {section:{meta, monthly, observedMonths, missingMonths},additionalEvidence};
}
