import type { EvidenceRef } from '@/types/consulting';
const statuses: Record<string,string> = { available:'수집됨', partial:'부분 수집', stale:'오래된 데이터', missing:'미수집', unmapped:'매핑 불가', error:'조회 오류' };
const checks: Record<string,string> = { pass:'통과', warning:'경고', fail:'실패', not_applicable:'해당 없음' };
export function formatEvidenceValue(ev: EvidenceRef | undefined): string {
  if (!ev) return '(근거 없음)';
  if (ev.value === null || ev.value === undefined) return '미관측';
  if (ev.source === 'status' && typeof ev.value === 'string' && statuses[ev.value]) return statuses[ev.value];
  if (ev.source === 'seo' && typeof ev.value === 'string' && checks[ev.value]) return checks[ev.value];
  // Rates are shown to one decimal (59.184% → 59.2%); other numbers keep the locale default.
  const base = typeof ev.value === 'number' ? ev.value.toLocaleString('ko-KR', ev.unit === '%' ? { maximumFractionDigits: 1 } : undefined) : ev.value;
  const unit = ev.unit ? ({ searches:'회', position:'위' } as Record<string,string>)[ev.unit] ?? ev.unit : '';
  return `${base}${unit}`;
}
export function renderEvidenceTokens(text: string, evidence: Map<string,EvidenceRef>) {
  if (!text) return ''; // 저장 JSON 의 누락 필드 방어 (화면·서버 공용)
  // The rendered value already carries its unit ("6명"); a unit the model also wrote right after the token
  // ("{{ev:x}}명") is dropped instead of doubling ("6명명", 2026-11-06 운영 리포트).
  // A token glued to a word or another token ("기록했습니다{{ev:x}}", "{{ev:a}}{{ev:b}}") is parenthesised so the value
  // stays readable ("기록했습니다(59.2%)") instead of fusing into the text.
  return text.replace(/\{\{ev:([a-zA-Z0-9_.-]+)\}\}(명|회|초|위|%|건|개)?/g, (_,id,after:string|undefined,offset:number) => {
    const raw = formatEvidenceValue(evidence.get(id));
    const value = after && raw.endsWith(after) ? raw : raw + (after ?? '');
    return /[가-힣A-Za-z0-9)}]/.test(text[offset - 1] ?? '') && !after ? `(${value})` : value;
  });
}
