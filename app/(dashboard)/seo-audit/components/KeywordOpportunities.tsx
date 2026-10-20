// app/(dashboard)/seo-audit/components/KeywordOpportunities.tsx
// 키워드 인벤토리·수요·광고 경쟁도·기회(isOpportunity) + 쓰기 액션(리서치 추가 / 선택 순위 갱신).
// 설계 §5.2·§6.5·§6.7. competition 은 '광고 경쟁도'이며 SEO 난이도와 분리 표기.
// 순위 갱신의 실제 계약은 keywordIds × engines(곱) — 혼합 엔진을 섞으면 각 키워드가 모든 선택 엔진으로
//   조회되어 조합이 늘어난다. 실제 곱으로 조합 수를 계산·표시하고 10 초과는 전송 전에 막는다(리뷰 지적 2).
// runKey 는 '같은 입력의 불확실한 재시도'엔 재사용하고 확인된 실행 뒤에만 새로 발급한다(리뷰 지적 1).
// 과금 mutation 의 결과 DTO 는 onAudit 으로 올려 활성 실행(폴링·상태·재개)에 연결한다(리뷰 지적 5).
// 수요 기준 기간·갱신일·순위 관측일을 노출하고 오래된/실패 보존값을 구분 표시한다(리뷰 지적 10).
// 데이터(목록)는 page 가 소유해 캐시 공유, 쓰기 mutation·선택·입력은 이 컴포넌트가 소유(단일 책임).
'use client';

import { useMemo, useRef, useState } from 'react';
import type { SeoAuditDTO, SeoKeywordDTO } from '@/types/seo';
import { ENGINE_LABELS, RANK_STATUS_META, formatDate, formatPercent, formatVolume, isStale } from '../constants';
import { SeoApiError } from '../api';
import { useResearchKeywords } from '../hooks/use-seo-keywords';
import { useRefreshRankings } from '../hooks/use-seo-rankings';

const MAX_COMBO = 10; // 설계 §5.2: 실제 조합(키워드×엔진) 최대 10

interface Props {
  domainId: string;
  keywords: SeoKeywordDTO[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchingMore: boolean;
  canWrite: boolean;
  /** 리서치·순위 갱신으로 시작된 실행을 활성화 (page 가 활성 auditId 추적) */
  onAudit: (audit: SeoAuditDTO) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

function msgOf(err: unknown): string {
  if (err instanceof SeoApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '요청을 처리하지 못했습니다';
}

export function KeywordOpportunities({ domainId, keywords, loading, error, hasMore, fetchingMore, canWrite, onAudit, onLoadMore, onRetry }: Props) {
  const researchM = useResearchKeywords();
  const refreshM = useRefreshRankings();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [researchText, setResearchText] = useState('');
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // 멱등 재시도용 서명+runKey (리뷰 지적 1). 리서치/순위 갱신 각각 보존.
  const researchAttempt = useRef<{ signature: string; runKey: string } | null>(null);
  const refreshAttempt = useRef<{ signature: string; runKey: string } | null>(null);

  const busy = researchM.isPending || refreshM.isPending;

  // 실제 제출 대상 행(로드된 목록 내) — 선택 Set 에 있으나 목록에 없는 ID 는 제출하지 않는다.
  const selectedRows = useMemo(() => keywords.filter((k) => selected.has(k.id)), [keywords, selected]);
  const distinctEngines = useMemo(
    () => Array.from(new Set(selectedRows.map((k) => k.engine))),
    [selectedRows],
  );
  // 서버 계약: keywordIds.length × engines.length. 혼합 엔진이면 곱으로 커진다.
  const comboCount = selectedRows.length * distinctEngines.length;
  const mixedEngines = distinctEngines.length > 1;
  const overLimit = comboCount > MAX_COMBO;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResearch = async () => {
    if (!canWrite || busy) return;
    const list = researchText
      .split(/[\n,]/)
      .map((s) => s.normalize('NFKC').trim())
      .filter(Boolean)
      .slice(0, 50);
    setActionMsg(null);

    const signature = JSON.stringify({ domainId, list });
    let runKey: string;
    if (researchAttempt.current?.signature === signature) {
      runKey = researchAttempt.current.runKey;
    } else {
      runKey = crypto.randomUUID();
      researchAttempt.current = { signature, runKey };
    }

    try {
      const audit = await researchM.mutateAsync({ domainId, runKey, keywords: list.length ? list : undefined });
      researchAttempt.current = null; // 확인된 실행 → 다음엔 새 키
      setResearchText('');
      setActionMsg({ text: '리서치를 시작했습니다. 아래 진행 상태에서 수집을 확인·재개할 수 있습니다.', ok: true });
      onAudit(audit);
    } catch (err) {
      setActionMsg({ text: msgOf(err), ok: false });
    }
  };

  const handleRefresh = async () => {
    if (!canWrite || busy || selectedRows.length === 0 || overLimit) return;
    const keywordIds = selectedRows.map((k) => k.id);
    const engines = distinctEngines;
    setActionMsg(null);

    const signature = JSON.stringify({ domainId, keywordIds: [...keywordIds].sort(), engines: [...engines].sort() });
    let runKey: string;
    if (refreshAttempt.current?.signature === signature) {
      runKey = refreshAttempt.current.runKey;
    } else {
      runKey = crypto.randomUUID();
      refreshAttempt.current = { signature, runKey };
    }

    try {
      const audit = await refreshM.mutateAsync({ domainId, runKey, keywordIds, engines });
      refreshAttempt.current = null;
      setSelected(new Set());
      setActionMsg({ text: '선택한 키워드의 순위 갱신을 시작했습니다. 아래 진행 상태에서 확인하세요.', ok: true });
      onAudit(audit);
    } catch (err) {
      setActionMsg({ text: msgOf(err), ok: false });
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 3v18h18" /><path d="M18 9l-5 5-4-4-3 3" />
        </svg>
        <span className="card-title">키워드 수요·기회</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>{keywords.length}{hasMore ? '+' : ''}개</span>
      </div>

      {/* 리서치 추가 (scope=research, 과금) */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={researchText}
            onChange={(e) => setResearchText(e.target.value)}
            disabled={busy}
            aria-label="리서치할 키워드 (쉼표/줄바꿈 구분, 최대 50, 비우면 사이트 기반 자동 발견)"
            placeholder="리서치할 키워드 (비우면 사이트 기반 자동 발견 · 쉼표 구분, 최대 50)"
            style={{ flex: 1, minWidth: 220, height: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, padding: '0 10px', fontFamily: 'inherit' }}
          />
          <button type="button" className="btn btn-primary" style={{ padding: '6px 11px', opacity: canWrite ? 1 : 0.5 }} disabled={!canWrite || busy} title={canWrite ? '외부 수집 비용이 발생합니다' : 'Starter 플랜부터 사용할 수 있습니다'} onClick={handleResearch}>
            {researchM.isPending ? '요청 중…' : '키워드 리서치'}
          </button>
        </div>
        <p style={{ fontSize: 10, color: 'var(--amber-700)' }}>리서치·순위 갱신은 외부 수집 비용이 발생하며 월 한도에서 차감됩니다.</p>
      </div>

      {/* 선택 순위 갱신 (scope=ranking, 과금) */}
      {keywords.length > 0 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--sub)' }}>
              선택 {selectedRows.length}
              {distinctEngines.length > 0 && ` · 엔진 ${distinctEngines.length}`}
              {' · 조합 '}
              <strong style={{ color: overLimit ? '#dc2626' : 'var(--text)' }}>{comboCount}</strong>/{MAX_COMBO}
            </span>
            <button type="button" className="btn btn-teal" style={{ padding: '5px 10px', opacity: canWrite && selectedRows.length > 0 && !overLimit ? 1 : 0.5 }} disabled={!canWrite || busy || selectedRows.length === 0 || overLimit} title={canWrite ? '선택한 키워드의 현재 순위를 직접 SERP 로 갱신합니다' : 'Starter 플랜부터 사용할 수 있습니다'} onClick={handleRefresh}>
              {refreshM.isPending ? '갱신 중…' : '선택 순위 갱신'}
            </button>
          </div>
          {overLimit && (
            <span role="status" style={{ fontSize: 10.5, color: '#dc2626' }}>
              조합이 {MAX_COMBO}개를 넘습니다(키워드 {selectedRows.length} × 엔진 {distinctEngines.length} = {comboCount}). 선택을 줄여 주세요.
            </span>
          )}
          {mixedEngines && !overLimit && (
            <span role="status" style={{ fontSize: 10.5, color: 'var(--amber-700)' }}>
              서로 다른 엔진의 키워드를 함께 선택하면 각 키워드가 선택된 모든 엔진({distinctEngines.map((e) => ENGINE_LABELS[e]).join('·')})으로 조회되어 조합이 늘어납니다.
            </span>
          )}
        </div>
      )}

      {actionMsg && <p role="status" style={{ fontSize: 11, color: actionMsg.ok ? 'var(--green-700)' : '#dc2626', padding: '8px 16px 0' }}>{actionMsg.text}</p>}

      {/* 목록 */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '36px 0' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <p role="alert" style={{ color: '#dc2626', fontSize: 12.5 }}>{error}</p>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onRetry}>다시 시도</button>
        </div>
      ) : keywords.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '36px 20px' }}>
          저장된 키워드가 없습니다. 위에서 키워드 리서치를 실행해 수요·기회를 수집하세요.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sub)', fontSize: 10 }}>
                  <th style={{ padding: '8px 16px', width: 28 }} />
                  <th style={{ padding: '8px 8px' }}>키워드</th>
                  <th style={{ padding: '8px 8px' }}>엔진</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>검색량</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>광고 경쟁도</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>캐시 순위</th>
                  <th style={{ padding: '8px 16px' }}>기회</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => {
                  const rankStatus = k.rankStatus ? RANK_STATUS_META[k.rankStatus] : null;
                  const hasRank = k.rank !== null && k.rank !== undefined;
                  // 보존된 과거값인데 최근 갱신이 실패/미완인 경우 — 최신처럼 보이지 않게 구분.
                  const rankFailed = hasRank && (k.rankStatus === 'failed' || k.rankStatus === 'pending');
                  const rankStaleByDate = hasRank && isStale(k.rankObservedAt);
                  const rankStale = rankFailed || rankStaleByDate;
                  return (
                    <tr key={k.id} style={{ borderTop: '1px solid var(--border2)' }}>
                      <td style={{ padding: '8px 16px' }}>
                        <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggle(k.id)} aria-label={`${k.keyword} 선택`} />
                      </td>
                      <td style={{ padding: '8px 8px', color: 'var(--text)', fontWeight: 600, maxWidth: 220, wordBreak: 'break-word' }}>{k.keyword}</td>
                      <td style={{ padding: '8px 8px', color: 'var(--sub)' }}>{ENGINE_LABELS[k.engine]}</td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text)' }}>
                        {formatVolume(k.searchVolume, k.volumeScale)}
                        {(k.volumePeriod || k.metricsUpdatedAt) && (
                          <div style={{ fontSize: 9, color: 'var(--sub)', fontWeight: 400, marginTop: 1 }}>
                            {k.volumePeriod ?? ''}{k.volumePeriod && k.metricsUpdatedAt ? ' · ' : ''}{k.metricsUpdatedAt ? `갱신 ${formatDate(k.metricsUpdatedAt)}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--sub)' }}>{k.competition === null ? '—' : formatPercent(k.competition)}</td>
                      <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                        {hasRank ? (
                          <>
                            <span style={{ color: rankStale ? 'var(--sub)' : 'var(--text)', fontWeight: 700 }}>{k.rank}</span>
                            {rankFailed && <div style={{ fontSize: 9, color: 'var(--amber-700)', fontWeight: 600 }}>갱신 실패 · 과거값</div>}
                            {!rankFailed && rankStaleByDate && <div style={{ fontSize: 9, color: 'var(--amber-700)', fontWeight: 600 }}>오래됨</div>}
                            {k.rankObservedAt && <div style={{ fontSize: 9, color: 'var(--sub)', fontWeight: 400 }}>관측 {formatDate(k.rankObservedAt)}</div>}
                          </>
                        ) : (
                          <span style={{ color: 'var(--sub)' }}>{rankStatus ? rankStatus.label : '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 16px' }}>
                        {k.isOpportunity ? (
                          <span
                            title={rankStale ? '과거 관측 기준(오늘 갱신 결과 아님)' : undefined}
                            style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--green-700)', background: 'var(--green-100)', borderRadius: 4, padding: '2px 7px', opacity: rankStale ? 0.6 : 1 }}
                          >
                            기회{rankStale ? '*' : ''}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--sub)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ padding: '10px 16px', textAlign: 'center', borderTop: '1px solid var(--border2)' }}>
              <button type="button" className="btn btn-ghost" disabled={fetchingMore} onClick={onLoadMore}>
                {fetchingMore ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
