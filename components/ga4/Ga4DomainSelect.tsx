// components/ga4/Ga4DomainSelect.tsx
// GA4 조회 대상 도메인 선택 (설계 §2.4 domain_required · §4.7 domain_id query).
// 빈 값 = 서버 기본(자동화 도메인 → 유일한 verified 바인딩). 소유 검증은 서버 책임(타인 도메인 404).
'use client';

import { useOwnedDomains } from '@/hooks/useOwnedDomains';

interface Props {
  value: string | null;
  onChange: (domainId: string | null) => void;
  disabled?: boolean;
}

export function Ga4DomainSelect({ value, onChange, disabled }: Props) {
  const { data: domains = [], isPending, isError } = useOwnedDomains();

  return (
    <select
      aria-label="GA4 조회 도메인"
      value={value ?? ''}
      disabled={disabled || isPending}
      onChange={(e) => onChange(e.target.value || null)}
      style={{
        height: 30, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)',
        color: 'var(--text)', fontSize: 11.5, padding: '0 8px', fontFamily: 'inherit',
      }}
    >
      <option value="">{isError ? '도메인 목록 오류 · 기본 도메인' : '기본 도메인'}</option>
      {domains.map((d) => (
        <option key={d.id} value={d.id}>{d.url}</option>
      ))}
    </select>
  );
}
