// app/(dashboard)/visibility/components/QueryManager.tsx
// 추적 질문 관리: 목록·생성·수정·삭제·활성토글·즉시 캡처. 데이터는 hooks 를 통해 서버와 연동.
// 서버 에러 code(plan_limit·rate_limited·feature_forbidden 등)를 사람이 읽을 메시지로 표시.
// 권한(HIGH1): 조회·수정·삭제·비활성화는 플랜 무관 허용. 생성·재활성·즉시 수집만 canWrite(starter+) 게이트.
// 동시성(MED3): 행별 busy 맵 + mutateAsync try/finally 로 각 행의 진행·결과·잠금을 독립 보존.
// 대량 목록(MED5): 클라이언트 검색 + 서버 상한(100) 정직 표기. (전체 커서 페이지네이션은 서버 계약 필요.)
'use client';

import { useMemo, useState } from 'react';
import type { VisibilityQueryDTO, Market, EngineId } from '@/types/visibility';
import { ENGINE_LABELS, FREQUENCY_LABELS, STATUS_META } from '../constants';
import { VisibilityApiError, type SnapshotResultItem, type CreateQueryBody } from '../api';
import { useCreateQuery, useUpdateQuery, useDeleteQuery, useCaptureSnapshot } from '../hooks/use-visibility-queries';
import { useVisibilityAccess } from './VisibilityGate';
import { QueryFormModal } from './QueryFormModal';

interface Props {
  queries: VisibilityQueryDTO[];
  loading: boolean;
  error: string | null;
  defaultMarket: Market;
  onRetry: () => void;
}

/** 서버 목록 상한(= schemas/visibility.ts queryList limit max). 이 수치에 도달하면 더 있을 수 있음을 알린다. */
const WRITE_GATE_TITLE = 'Starter 플랜부터 사용할 수 있습니다';

function msgOf(err: unknown): string {
  if (err instanceof VisibilityApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '요청을 처리하지 못했습니다';
}

type RowAction = 'capture' | 'toggle' | 'delete';

export function QueryManager({ queries, loading, error, defaultMarket, onRetry }: Props) {
  const { canWrite } = useVisibilityAccess();
  const createM = useCreateQuery();
  const updateM = useUpdateQuery();
  const deleteM = useDeleteQuery();
  const captureM = useCaptureSnapshot();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VisibilityQueryDTO | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [snapResults, setSnapResults] = useState<Record<string, SnapshotResultItem[]>>({});
  const [busy, setBusy] = useState<Record<string, RowAction>>({});
  const [search, setSearch] = useState('');

  const submitting = createM.isPending || updateM.isPending;

  const markBusy = (id: string, a: RowAction) => setBusy((b) => ({ ...b, [id]: a }));
  const clearBusy = (id: string) =>
    setBusy((b) => {
      const n = { ...b };
      delete n[id];
      return n;
    });
  const clearRowMsg = (id: string) => setRowMsg((m) => ({ ...m, [id]: '' }));

  const openCreate = () => { if (!canWrite) return; setEditing(null); setFormError(null); setModalOpen(true); };
  const openEdit = (q: VisibilityQueryDTO) => { setEditing(q); setFormError(null); setModalOpen(true); };
  const closeModal = () => { if (submitting) return; setModalOpen(false); setEditing(null); setFormError(null); };

  // 저장은 mutateAsync 로 원래 폼에만 결과를 반영한다(MED8 — 모달도 저장 중 닫기를 차단).
  const handleSubmit = async (body: CreateQueryBody) => {
    setFormError(null);
    try {
      if (editing) await updateM.mutateAsync({ id: editing.id, body });
      else await createM.mutateAsync(body);
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(msgOf(err));
    }
  };

  const handleDelete = async (q: VisibilityQueryDTO) => {
    if (busy[q.id]) return; // 진행 중 행은 중복 조작 차단(MED3)
    if (!window.confirm(`"${q.query}" 질문과 수집 이력을 삭제할까요? (비용 이력은 보존됩니다)`)) return;
    clearRowMsg(q.id);
    markBusy(q.id, 'delete');
    try {
      await deleteM.mutateAsync(q.id);
    } catch (err) {
      setRowMsg((m) => ({ ...m, [q.id]: msgOf(err) }));
    } finally {
      clearBusy(q.id);
    }
  };

  const toggleActive = async (q: VisibilityQueryDTO) => {
    if (busy[q.id]) return;
    if (!q.active && !canWrite) return; // 재활성은 쓰기 권한 필요(비활성화는 허용)
    clearRowMsg(q.id);
    markBusy(q.id, 'toggle');
    try {
      await updateM.mutateAsync({ id: q.id, body: { active: !q.active } });
    } catch (err) {
      setRowMsg((m) => ({ ...m, [q.id]: msgOf(err) }));
    } finally {
      clearBusy(q.id);
    }
  };

  const runSnapshot = async (q: VisibilityQueryDTO) => {
    if (busy[q.id]) return;
    if (!canWrite) return;
    clearRowMsg(q.id);
    // 실행 시작 시 이전 결과 배지를 제거(MED4): 직전 성공 배지가 이번 결과처럼 남지 않게.
    setSnapResults((s) => {
      const n = { ...s };
      delete n[q.id];
      return n;
    });
    markBusy(q.id, 'capture');
    try {
      const res = await captureM.mutateAsync({ queryId: q.id });
      setSnapResults((s) => ({ ...s, [q.id]: res.results }));
    } catch (err) {
      // 전 엔진 실패(502)여도 서버 상태(실패 건수·최근 수집 시각)는 바뀌므로 onSettled 가 목록을 재조회한다.
      setRowMsg((m) => ({ ...m, [q.id]: msgOf(err) }));
    } finally {
      clearBusy(q.id);
    }
  };

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return queries;
    return queries.filter(
      (q) =>
        q.query.toLowerCase().includes(s) ||
        q.brandAliases.some((a) => a.toLowerCase().includes(s)) ||
        q.competitorAliases.some((a) => a.toLowerCase().includes(s)),
    );
  }, [queries, search]);

  const countLabel = search
    ? `${visible.length} / ${queries.length}건`
    : `${queries.length}건`;

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <span className="card-title">추적 질문 관리</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>{countLabel}</span>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto', padding: '6px 11px', opacity: canWrite ? 1 : 0.5 }} disabled={!canWrite} title={canWrite ? undefined : WRITE_GATE_TITLE} onClick={openCreate}>
          + 질문 추가
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '36px 0' }}>
          <p style={{ color: '#dc2626', fontSize: 12.5 }}>{error}</p>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onRetry}>다시 시도</button>
        </div>
      ) : queries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '44px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--sub)' }}>아직 추적 중인 질문이 없습니다</p>
          <p style={{ fontSize: 11.5, color: 'var(--sub)' }}>브랜드가 AI 답변에 얼마나 노출되는지 추적할 질문을 추가하세요.</p>
          <button type="button" className="btn btn-primary" disabled={!canWrite} title={canWrite ? undefined : WRITE_GATE_TITLE} onClick={openCreate}>첫 질문 추가</button>
          {!canWrite && <p style={{ fontSize: 11, color: 'var(--amber-700)' }}>질문 추가는 Starter 플랜부터 가능합니다.</p>}
        </div>
      ) : (
        <>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="질문·브랜드·경쟁사 별칭으로 검색"
              aria-label="질문 검색"
              style={{ width: '100%', height: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, padding: '0 10px', fontFamily: 'inherit' }}
            />
          </div>

          {visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 20px' }}>
              <p style={{ fontSize: 12.5, color: 'var(--sub)' }}>검색 결과가 없습니다.</p>
            </div>
          ) : (
            <div>
              {visible.map((q) => {
                const action = busy[q.id];
                const rowBusy = !!action;
                const results = snapResults[q.id];
                const reactivateGated = !q.active && !canWrite;
                return (
                  <div key={q.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border2)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{q.query}</span>
                          {!q.active && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--sub)', background: 'var(--n100)', borderRadius: 4, padding: '1px 6px' }}>비활성</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                          <span style={{ fontSize: 10, color: 'var(--sub)' }}>{q.market}</span>
                          <span style={{ fontSize: 10, color: 'var(--sub)' }}>· {FREQUENCY_LABELS[q.frequency]}</span>
                          <span style={{ fontSize: 10, color: 'var(--sub)' }}>· {q.engines.map((e) => ENGINE_LABELS[e as EngineId] ?? e).join(', ')}</span>
                          <span style={{ fontSize: 10, color: 'var(--sub)' }}>
                            · 최근 수집 {q.lastCapturedAt ? q.lastCapturedAt.slice(0, 10) : '없음'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button type="button" className="btn btn-teal" style={{ padding: '5px 9px', opacity: canWrite ? 1 : 0.5 }} disabled={rowBusy || !canWrite} title={canWrite ? undefined : WRITE_GATE_TITLE} onClick={() => runSnapshot(q)}>
                          {action === 'capture' ? '수집 중…' : '즉시 수집'}
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ padding: '5px 9px', opacity: reactivateGated ? 0.5 : 1 }} disabled={rowBusy || reactivateGated} title={reactivateGated ? WRITE_GATE_TITLE : undefined} onClick={() => toggleActive(q)}>
                          {action === 'toggle' ? '처리 중…' : q.active ? '비활성' : '재활성'}
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ padding: '5px 9px' }} disabled={rowBusy} onClick={() => openEdit(q)}>수정</button>
                        <button type="button" className="btn btn-ghost" style={{ padding: '5px 9px', color: '#dc2626' }} disabled={rowBusy} onClick={() => handleDelete(q)}>
                          {action === 'delete' ? '삭제 중…' : '삭제'}
                        </button>
                      </div>
                    </div>

                    {results && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {results.map((r) => {
                          const meta = STATUS_META[r.status];
                          return (
                            <span key={r.engine} title={r.failReason} style={{ fontSize: 10, fontWeight: 600, color: meta.color, background: meta.bg, borderRadius: 5, padding: '2px 7px' }}>
                              {ENGINE_LABELS[r.engine]} · {meta.label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {rowMsg[q.id] && (
                      <p style={{ fontSize: 10.5, color: '#dc2626', marginTop: 6 }}>{rowMsg[q.id]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <QueryFormModal
          initial={editing}
          defaultMarket={defaultMarket}
          submitting={submitting}
          errorMessage={formError}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
