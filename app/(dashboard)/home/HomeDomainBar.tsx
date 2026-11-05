// app/(dashboard)/home/HomeDomainBar.tsx
// 홈 GA4 조회 도메인 선택 — 분석 섹션 공통 DomainBar 재사용(v2.14.0 공통 도메인 바).
// 표시 조건(서버 판단): GA4 범위가 domain_required 이거나 ?domainId= 로 이미 선택한 경우.
// 우선순위: URL ?domainId= > 마지막 선택(localStorage). 소유 검증은 서버(resolveGa4Scope ownerId) 책임.
'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOwnedDomains } from '@/hooks/useOwnedDomains';
import { DomainBar } from '../components/domain/DomainBar';
import { readSelectedDomain, writeSelectedDomain } from '../components/domain/selected-domain';

interface Props {
  selectedId: string | null;
  /** 서버가 domain_required 로 판정 — 기본 도메인을 정할 수 없음 */
  domainRequired: boolean;
}

export function HomeDomainBar({ selectedId, domainRequired }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: domains = [], isPending, error, refetch } = useOwnedDomains();

  const select = (id: string) => {
    writeSelectedDomain(id);
    router.replace(`${pathname}?domainId=${encodeURIComponent(id)}`, { scroll: false });
  };

  // 선택 없이 domain_required 면 마지막 선택 도메인을 복원한다(목록에 있을 때만)
  useEffect(() => {
    if (selectedId || !domainRequired || !domains.length) return;
    const stored = readSelectedDomain();
    if (stored && domains.some((d) => d.id === stored)) {
      router.replace(`${pathname}?domainId=${encodeURIComponent(stored)}`, { scroll: false });
    }
  }, [selectedId, domainRequired, domains, pathname, router]);

  const selected = domains.find((d) => d.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      <DomainBar
        label="GA4 조회 도메인"
        domains={domains}
        loading={isPending}
        error={error ? error.message || '도메인 목록을 불러오지 못했습니다' : null}
        selectedId={selectedId}
        defaultMarket={selected?.market ?? 'ko-KR'}
        onSelect={select}
        onRetry={() => { void refetch(); }}
        onCreated={(d) => select(d.id)}
      />
      {domainRequired && !selectedId && (
        <p role="status" style={{ fontSize: 11.5, color: 'var(--sub)', margin: 0 }}>
          GA4가 연결된 도메인이 여러 개입니다. 방문자·성과 지표를 볼 도메인을 선택하세요.
        </p>
      )}
    </div>
  );
}
