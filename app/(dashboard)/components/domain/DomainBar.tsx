// app/(dashboard)/components/domain/DomainBar.tsx
// 분석 섹션 공통 도메인 바 — 선택 + 인라인 등록(+ 새 도메인) + market 표시.
// 기존 SeoDomainSelector/ConsultingDomainSelector 를 대체(중복 해소). 등록을 /visibility 로
// 떠넘기지 않고 어느 화면에서든 바로 등록한다. 검색/더보기는 선택적(컨설팅 호환).
// 표시·입력만 담당 — 목록 패칭은 부모가, 생성은 공통 useCreateDomain 이 수행한다.
'use client';

import { useState } from 'react';
import { MARKETS, type DomainDTO, type Market } from '@/types/visibility';
import { useCreateDomain } from './use-create-domain';
import { DomainApiError } from './api';

const MARKET_LABELS: Record<Market, string> = {
  'ko-KR': '한국 · ko-KR',
  'en-US': '미국 · en-US',
  'en-GB': '영국 · en-GB',
  'en-CA': '캐나다 · en-CA',
  'en-AU': '호주 · en-AU',
};

interface Props {
  /** 라벨 (예: "진단 대상 도메인") */
  label: string;
  domains: DomainDTO[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** 신규 등록 폼의 기본 market (현재 선택 도메인 market 또는 화면 기본값) */
  defaultMarket: Market;
  onSelect: (id: string) => void;
  onRetry: () => void;
  /** 등록 성공 → 부모가 목록 refetch + 해당 도메인 선택 */
  onCreated: (domain: DomainDTO) => void;
  // ── 선택: 서버측 검색/페이지네이션(컨설팅) ──
  search?: string;
  onSearch?: (q: string) => void;
  hasMore?: boolean;
  fetchingMore?: boolean;
  onLoadMore?: () => void;
}

function msgOf(err: unknown): string {
  if (err instanceof DomainApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '도메인을 등록하지 못했습니다';
}

const field: React.CSSProperties = {
  height: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: 12, padding: '0 8px', fontFamily: 'inherit',
};

export function DomainBar({
  label, domains, loading, error, selectedId, defaultMarket,
  onSelect, onRetry, onCreated, search, onSearch, hasMore, fetchingMore, onLoadMore,
}: Props) {
  const createM = useCreateDomain();
  const empty = !loading && !error && domains.length === 0;
  // 등록된 도메인이 없으면 등록 폼을 자동으로 연다(떠넘기기 제거).
  const [showNew, setShowNew] = useState(false);
  const open = showNew || empty;

  const [url, setUrl] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [market, setMarket] = useState<Market>(defaultMarket);
  const [formErr, setFormErr] = useState<string | null>(null);

  const handleCreate = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setFormErr('도메인을 입력하세요 (예: example.com)'); return; }
    setFormErr(null);
    try {
      const d = await createM.mutateAsync({ url: trimmed, market, businessType: businessType.trim() || undefined });
      setUrl(''); setBusinessType(''); setShowNew(false);
      onCreated(d);
    } catch (err) {
      setFormErr(msgOf(err));
    }
  };

  return (
    <div className="card" style={{ gap: 10, padding: '12px 16px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
        <label htmlFor="domainbar-select" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{label}</label>

        {loading ? (
          <span style={{ fontSize: 12, color: 'var(--sub)' }}>도메인 불러오는 중…</span>
        ) : error ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span role="alert" style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>
            <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={onRetry}>다시 시도</button>
          </span>
        ) : empty ? (
          <span style={{ fontSize: 12, color: 'var(--sub)' }}>등록된 도메인이 없습니다. 아래에서 첫 도메인을 등록하세요.</span>
        ) : (
          <>
            {onSearch && (
              <input
                type="search"
                value={search ?? ''}
                placeholder="도메인 검색"
                onChange={(e) => onSearch(e.target.value)}
                style={{ ...field, minWidth: 140, flex: '0 1 180px' }}
                aria-label="도메인 검색"
              />
            )}
            <select
              id="domainbar-select"
              value={selectedId ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              style={{ ...field, minWidth: 240, flex: 1, maxWidth: 420 }}
            >
              {!selectedId && <option value="">도메인 선택</option>}
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.url} · {MARKET_LABELS[d.market]}</option>
              ))}
            </select>
            {hasMore && onLoadMore && (
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }} disabled={fetchingMore} onClick={onLoadMore}>
                {fetchingMore ? '불러오는 중…' : '더 보기'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}
              onClick={() => { setShowNew((v) => !v); setFormErr(null); }}
            >
              {showNew ? '취소' : '+ 새 도메인'}
            </button>
          </>
        )}
      </div>

      {open && (
        <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              value={url} maxLength={253} disabled={createM.isPending}
              placeholder="도메인 주소 예) minteq.co.kr 또는 https://minteq.co.kr"
              onChange={(e) => setUrl(e.target.value)}
              style={{ ...field, flex: '2 1 240px' }}
              aria-label="도메인 주소"
            />
            <input
              value={businessType} maxLength={100} disabled={createM.isPending}
              placeholder="업종 (선택) 예) 치과"
              onChange={(e) => setBusinessType(e.target.value)}
              style={{ ...field, flex: '1 1 140px' }}
              aria-label="업종"
            />
            <select value={market} disabled={createM.isPending} onChange={(e) => setMarket(e.target.value as Market)} style={{ ...field, flex: '1 1 160px' }} aria-label="시장">
              {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABELS[m]}</option>)}
            </select>
            <button type="button" className="btn btn-primary" style={{ padding: '6px 14px', whiteSpace: 'nowrap' }} disabled={createM.isPending} onClick={handleCreate}>
              {createM.isPending ? '등록 중…' : '도메인 등록'}
            </button>
          </div>
          {formErr && <p role="alert" style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{formErr}</p>}
        </div>
      )}
    </div>
  );
}
