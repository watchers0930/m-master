// app/(dashboard)/seo-audit/components/SeoDomainSelector.tsx
// 기존 Domain 목록 공유·선택 (설계 §8: SEO 전용 등록 폼 중복 구현 금지).
// 도메인이 없으면 등록 흐름(/visibility)로 안내만 한다(여기서 생성 폼을 열지 않는다).
'use client';

import Link from 'next/link';
import type { DomainDTO } from '@/types/visibility';
import { MARKET_LABELS } from '../constants';

interface Props {
  domains: DomainDTO[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function SeoDomainSelector({ domains, loading, error, selectedId, onSelect, onRetry }: Props) {
  return (
    <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
      <label htmlFor="seo-domain-select" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>진단 대상 도메인</label>

      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--sub)' }}>도메인 불러오는 중…</span>
      ) : error ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span role="alert" style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>
          <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={onRetry}>다시 시도</button>
        </span>
      ) : domains.length === 0 ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--sub)' }}>등록된 도메인이 없습니다.</span>
          <Link href="/visibility" className="btn btn-ghost" style={{ padding: '4px 10px' }}>도메인 등록하러 가기</Link>
        </span>
      ) : (
        <select
          id="seo-domain-select"
          value={selectedId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{ height: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, padding: '0 8px', fontFamily: 'inherit', minWidth: 240, flex: 1, maxWidth: 420 }}
        >
          {!selectedId && <option value="">도메인 선택</option>}
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.url} · {MARKET_LABELS[d.market]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
