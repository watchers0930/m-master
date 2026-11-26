// app/(dashboard)/visibility/components/QueryFormModal.tsx
// 질문 생성·수정 폼 모달. 클라이언트 검증은 UX 보조이고, 최종 검증은 서버(zod)가 수행.
// 설계 §3.4 입력 상한을 화면에서 미리 안내: query 1~1000 / brand 1~20 / competitor 0~20 / engine 1~5(시장별 지원 엔진만).
// 접근성(MED7): role=dialog·aria-modal·제목 연결·초기 포커스·포커스 트랩·Escape·포커스 복원,
//   필드 id/htmlFor, 엔진 버튼 aria-pressed.
// 저장 중(MED8): 배경·×·Escape 등 모든 닫기 경로를 차단하고 필드를 비활성화해
//   지연 응답이 다른 폼으로 섞이는 재진입 혼선을 원천 차단한다.
// 도메인 등록(HIGH2): 모달 안에서 직접 POST /api/domains 로 등록 후 선택한다.
//   모달이 열릴 때만 도메인 목록을 조회(지연 로딩)해 불필요한 GET 도 줄인다(LOW9).
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { VisibilityQueryDTO, EngineId, Market, Frequency } from '@/types/visibility';
import { MARKETS } from '@/types/visibility';
import { ALL_ENGINES, ENGINE_LABELS, MARKET_LABELS, FREQUENCY_LABELS } from '../constants';
import { MARKET_ENGINES } from '@/lib/market/constants';
import { aliasInQuestion, normalizeText } from '@/lib/visibility/text';
import { VisibilityApiError, type CreateQueryBody } from '../api';
import { useDomains, useCreateDomain } from '../hooks/use-domains';

interface Props {
  initial?: VisibilityQueryDTO | null; // 있으면 수정, 없으면 신규
  defaultMarket: Market;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (body: CreateQueryBody) => void;
  onClose: () => void;
}

function msgOf(err: unknown): string {
  if (err instanceof VisibilityApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '요청을 처리하지 못했습니다';
}

function parseAliases(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

const field: React.CSSProperties = {
  width: '100%', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5,
  padding: '8px 10px', fontFamily: 'inherit',
};
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'block' };
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--sub)', marginTop: 3 };

export function QueryFormModal({ initial, defaultMarket, submitting, errorMessage, onSubmit, onClose }: Props) {
  const isEdit = !!initial;
  const [query, setQuery] = useState(initial?.query ?? '');
  const [market, setMarket] = useState<Market>(initial?.market ?? defaultMarket);
  const [domainId, setDomainId] = useState<string>(initial?.domainId ?? '');
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'weekly');
  const [brandRaw, setBrandRaw] = useState((initial?.brandAliases ?? []).join(', '));
  const [competitorRaw, setCompetitorRaw] = useState((initial?.competitorAliases ?? []).join(', '));
  const [engines, setEngines] = useState<EngineId[]>(() =>
    (initial?.engines ?? [...ALL_ENGINES]).filter((en) => MARKET_ENGINES[initial?.market ?? defaultMarket].includes(en)),
  );

  // 도메인: 모달이 열린 동안에만 조회(지연 로딩) + 인라인 등록
  const domainsQuery = useDomains();
  const createDomainM = useCreateDomain();
  const domains = domainsQuery.data ?? [];
  const [showNewDomain, setShowNewDomain] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newBusinessType, setNewBusinessType] = useState('');
  const [domainErr, setDomainErr] = useState<string | null>(null);

  // 시장을 바꾸면 그 시장이 지원하지 않는 엔진(예: 해외 시장의 네이버)은 선택에서 빠진다(상태에서도 제거) — 서버도 같은 기준으로 거부.
  const availableEngines = MARKET_ENGINES[market];
  const selectedEngines = useMemo(() => engines.filter((en) => availableEngines.includes(en)), [engines, availableEngines]);

  const brandAliases = useMemo(() => parseAliases(brandRaw), [brandRaw]);
  const competitorAliases = useMemo(() => parseAliases(competitorRaw), [competitorRaw]);
  // 서버 판정(lib/visibility/detect.ts)과 같은 함수로 판단한다
  const brandInQuery = useMemo(() => {
    const q = normalizeText(query);
    return brandAliases.some((a) => aliasInQuestion(q, normalizeText(a)));
  }, [query, brandAliases]);

  const errors = useMemo(() => {
    const e: string[] = [];
    const q = query.trim();
    if (q.length < 1 || q.length > 1000) e.push('질문은 1~1000자여야 합니다');
    if (brandAliases.length < 1 || brandAliases.length > 20) e.push('브랜드 별칭은 1~20개여야 합니다');
    if (brandAliases.some((a) => a.length > 100)) e.push('브랜드 별칭은 각 100자 이하여야 합니다');
    if (competitorAliases.length > 20) e.push('경쟁사 별칭은 최대 20개입니다');
    if (competitorAliases.some((a) => a.length > 100)) e.push('경쟁사 별칭은 각 100자 이하여야 합니다');
    if (selectedEngines.length < 1 || selectedEngines.length > 5) e.push('엔진은 1~5개 선택해야 합니다');
    return e;
  }, [query, brandAliases, competitorAliases, selectedEngines]);

  const toggleEngine = (en: EngineId) =>
    setEngines((prev) => (prev.includes(en) ? prev.filter((x) => x !== en) : [...prev, en]));

  const handleSubmit = () => {
    if (errors.length > 0 || submitting) return;
    onSubmit({
      query: query.trim(),
      market,
      domainId: domainId || null,
      engines: selectedEngines,
      brandAliases,
      competitorAliases,
      frequency,
    });
  };

  const handleAddDomain = async () => {
    const url = newUrl.trim();
    if (!url) { setDomainErr('도메인을 입력하세요 (예: example.com)'); return; }
    setDomainErr(null);
    try {
      const d = await createDomainM.mutateAsync({ url, market, businessType: newBusinessType.trim() || undefined });
      setDomainId(d.id); // 등록 성공 → 즉시 선택
      setShowNewDomain(false);
      setNewUrl('');
      setNewBusinessType('');
    } catch (err) {
      setDomainErr(msgOf(err));
    }
  };

  // ── 접근성: 닫기 가드 / Escape / 포커스 트랩 / 초기 포커스 / 포커스 복원 ──
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef<HTMLTextAreaElement | null>(null);

  // 저장 중에는 모든 닫기 경로를 막는다(MED8). 아니면 onClose 위임.
  const requestClose = () => { if (!submitting) onClose(); };

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // 초기 포커스: 첫 입력(추적 질문)
    queryRef.current?.focus();
    return () => {
      // 닫힌 후 포커스 복원
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      onClick={requestClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,24,55,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qfm-title"
        className="card"
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="card-head">
          <span className="card-title" id="qfm-title">{isEdit ? '질문 수정' : '새 추적 질문'}</span>
          <button type="button" aria-label="닫기" onClick={requestClose} disabled={submitting} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--sub)', fontSize: 18, lineHeight: 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl} htmlFor="qfm-query">추적 질문</label>
            <textarea id="qfm-query" ref={queryRef} style={{ ...field, minHeight: 60, resize: 'vertical' }} value={query} maxLength={1000} disabled={submitting} placeholder="예) 서울 강남 교정치과 추천" onChange={(e) => setQuery(e.target.value)} />
            <p style={hint}>{query.trim().length}/1000자</p>
            {brandInQuery && (
              <p style={{ ...hint, color: 'var(--amber-700)' }}>질문에 브랜드 이름이 들어 있어 이 질문은 언급률 집계에서 빠지고 인용률만 집계됩니다(답변이 질문을 따라 쓴 것과 실제 언급을 구분할 수 없음)</p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="qfm-market">시장</label>
              <select id="qfm-market" style={field} value={market} disabled={submitting} onChange={(e) => {
                const next = e.target.value as Market;
                setMarket(next);
                setEngines((prev) => prev.filter((en) => MARKET_ENGINES[next].includes(en)));
              }}>
                {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABELS[m]}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="qfm-frequency">수집 주기</label>
              <select id="qfm-frequency" style={field} value={frequency} disabled={submitting} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {(['weekly', 'daily'] as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={lbl} htmlFor="qfm-domain">연결 도메인 (선택)</label>
            {domainsQuery.isPending ? (
              <p style={{ ...hint, marginTop: 0 }}>도메인 목록을 불러오는 중…</p>
            ) : domainsQuery.error ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontSize: 11, color: '#dc2626' }}>도메인 목록을 불러오지 못했습니다.</p>
                <button type="button" className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => domainsQuery.refetch()}>다시 시도</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select id="qfm-domain" style={{ ...field, flex: 1 }} value={domainId} disabled={submitting} onChange={(e) => setDomainId(e.target.value)}>
                    <option value="">연결 안 함</option>
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.url}</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', whiteSpace: 'nowrap' }} disabled={submitting} onClick={() => { setShowNewDomain((v) => !v); setDomainErr(null); }}>
                    {showNewDomain ? '취소' : '+ 새 도메인'}
                  </button>
                </div>
                {domains.length === 0 && !showNewDomain && (
                  <p style={hint}>등록된 도메인이 없습니다. “+ 새 도메인”으로 등록한 뒤 연결하세요.</p>
                )}
              </>
            )}

            {showNewDomain && !domainsQuery.error && (
              <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--n50, var(--surface))', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={lbl} htmlFor="qfm-new-domain">도메인 주소</label>
                  <input id="qfm-new-domain" style={field} value={newUrl} maxLength={253} disabled={submitting || createDomainM.isPending} placeholder="예) minteq.co.kr 또는 https://minteq.co.kr" onChange={(e) => setNewUrl(e.target.value)} />
                </div>
                <div>
                  <label style={lbl} htmlFor="qfm-new-biz">업종 (선택)</label>
                  <input id="qfm-new-biz" style={field} value={newBusinessType} maxLength={100} disabled={submitting || createDomainM.isPending} placeholder="예) 치과" onChange={(e) => setNewBusinessType(e.target.value)} />
                </div>
                {domainErr && <p style={{ fontSize: 11, color: '#dc2626' }}>{domainErr}</p>}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-primary" style={{ padding: '6px 12px' }} disabled={submitting || createDomainM.isPending} onClick={handleAddDomain}>
                    {createDomainM.isPending ? '등록 중…' : '도메인 등록'}
                  </button>
                </div>
              </div>
            )}

            <p style={hint}>
              {domainId
                ? '도메인을 연결하면 인용 판정(자사 여부)에 사용됩니다'
                : '도메인을 연결하지 않으면 인용률(자사 인용) 지표의 유효 표본이 집계되지 않습니다'}
            </p>
          </div>

          <div>
            <label style={lbl} htmlFor="qfm-brand">브랜드 별칭 (쉼표/줄바꿈 구분)</label>
            <textarea id="qfm-brand" style={{ ...field, minHeight: 44, resize: 'vertical' }} value={brandRaw} disabled={submitting} placeholder="예) 민텍, MINTEQ, 민텍치과" onChange={(e) => setBrandRaw(e.target.value)} />
            <p style={hint}>{brandAliases.length}개 (1~20개)</p>
          </div>

          <div>
            <label style={lbl} htmlFor="qfm-competitor">경쟁사 별칭 (선택, 쉼표/줄바꿈 구분)</label>
            <textarea id="qfm-competitor" style={{ ...field, minHeight: 44, resize: 'vertical' }} value={competitorRaw} disabled={submitting} placeholder="예) 경쟁치과A, 경쟁치과B" onChange={(e) => setCompetitorRaw(e.target.value)} />
            <p style={hint}>{competitorAliases.length}개 (최대 20개)</p>
          </div>

          <div>
            <span style={lbl} id="qfm-engines-label">추적 엔진</span>
            <div role="group" aria-labelledby="qfm-engines-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ALL_ENGINES.filter((en) => availableEngines.includes(en)).map((en) => {
                const on = selectedEngines.includes(en);
                return (
                  <button
                    key={en}
                    type="button"
                    aria-pressed={on}
                    disabled={submitting}
                    onClick={() => toggleEngine(en)}
                    style={{
                      padding: '6px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                      border: `1px solid ${on ? 'var(--blue-400)' : 'var(--border)'}`,
                      background: on ? 'var(--blue-50)' : 'var(--surface)',
                      color: on ? 'var(--blue-600)' : 'var(--sub)',
                    }}
                  >
                    {ENGINE_LABELS[en]}
                  </button>
                );
              })}
            </div>
            <p style={hint}>{selectedEngines.length}개 선택 (1~5개)</p>
          </div>

          {errors.length > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 10px' }}>
              {errors.map((er) => <p key={er} style={{ fontSize: 11, color: 'var(--amber-700)' }}>• {er}</p>)}
            </div>
          )}
          {errorMessage && (
            <div role="alert" style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 7, padding: '8px 10px' }}>
              <p style={{ fontSize: 11.5, color: '#dc2626' }}>{errorMessage}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={requestClose} disabled={submitting}>취소</button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting || errors.length > 0}>
              {submitting ? '저장 중…' : isEdit ? '수정 저장' : '질문 추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
