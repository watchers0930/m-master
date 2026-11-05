import type { EvidenceRef } from '@/types/consulting';
const statuses: Record<string,string> = { available:'수집됨', partial:'부분 수집', stale:'오래된 데이터', missing:'미수집', unmapped:'매핑 불가', error:'조회 오류' };
const checks: Record<string,string> = { pass:'통과', warning:'경고', fail:'실패', not_applicable:'해당 없음' };
export function formatEvidenceValue(ev: EvidenceRef | undefined): string {
  if (!ev) return '(근거 없음)';
  if (ev.value === null || ev.value === undefined) return '미관측';
  if (ev.source === 'status' && typeof ev.value === 'string' && statuses[ev.value]) return statuses[ev.value];
  if (ev.source === 'seo' && typeof ev.value === 'string' && checks[ev.value]) return checks[ev.value];
  const base = typeof ev.value === 'number' ? ev.value.toLocaleString('ko-KR') : ev.value;
  const unit = ev.unit ? ({ searches:'회', position:'위' } as Record<string,string>)[ev.unit] ?? ev.unit : '';
  return `${base}${unit}`;
}
export function renderEvidenceTokens(text: string, evidence: Map<string,EvidenceRef>) {
  if (!text) return ''; // 저장 JSON 의 누락 필드 방어 (화면·서버 공용)
  return text.replace(/\{\{ev:([a-zA-Z0-9_.-]+)\}\}/g, (_,id) => formatEvidenceValue(evidence.get(id)));
}
