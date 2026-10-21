import type { ConsultingSnapshot, SectionMeta } from "@/types/consulting";
export function sectionMeta(snapshot: ConsultingSnapshot, ids: string[], ready: boolean, unit: string|null = null): SectionMeta {
  const evidenceIds = [...new Set(ids)].sort(), wanted = new Set(evidenceIds);
  const evidence = snapshot.evidence.filter(e => wanted.has(e.id));
  if (evidence.length !== evidenceIds.length) throw new Error("unknown_section_evidence");
  const dates = evidence.flatMap(e => e.observedAt ? [e.observedAt] : []).sort();
  const observedAt = dates.at(-1) ?? null;
  const stale = observedAt !== null && observedAt < snapshot.range.from;
  return {sourceStatus: ready ? stale ? "stale" : "partial" : "missing",
    reason: ready ? stale ? "관측 기간보다 오래된 저장 근거입니다." : "선택 키워드와 관측된 자료 범위의 부분 자료입니다." : "준비 필요: 검증된 저장 근거가 없습니다.",
    evidenceIds, observedAt, market:snapshot.market, location:snapshot.structuredMetrics?.location ?? null,
    period:null, unit, currency:null,
    selection:snapshot.selection.find(s => s.source === "structured_keywords") ? (()=>{const {source:_,...s}=snapshot.selection.find(s=>s.source==="structured_keywords")!;return s;})() : null,
    coverage:null};
}

export function keywordCurrency(snapshot: ConsultingSnapshot): SectionMeta["currency"] {
  const rows = (snapshot.structuredMetrics?.keywords ?? []).filter(k => k.cpc !== null);
  if (!rows.length || rows.some(k => k.currency === null)) return null;
  const currencies = new Set(rows.map(k => k.currency));
  return currencies.size === 1 ? rows[0].currency : null;
}
