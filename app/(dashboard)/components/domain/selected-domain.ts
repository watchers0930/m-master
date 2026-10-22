// app/(dashboard)/components/domain/selected-domain.ts
// 분석 섹션에서 마지막으로 선택한 도메인을 화면 간에 유지한다.
// 우선순위: URL ?domainId= > localStorage > 첫 도메인. SSR 안전(window 가드).
'use client';

const KEY = 'minteq:selectedDomainId';

export function readSelectedDomain(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeSelectedDomain(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* 저장 불가(프라이빗 모드 등) — 선택 기억은 선택적 기능이라 조용히 무시 */
  }
}
