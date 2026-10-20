// app/(dashboard)/seo-audit/components/AuditRunPanel.tsx
// 전체 진단(scope=full) 실행 패널: 수집 모드·엔진·대표 경로 선택 + 비용 발생 명시 + 실행.
// POST /api/seo/audit 는 scope='full' 로 기술 감사 + 키워드 발견·수요 + 자동 후보 순위까지 수행한다
// (app/api/seo/audit/route.ts). 진행 중(pending/partial) 실행은 재개(POST .../resume) 버튼 노출.
// runKey 는 '입력이 같은 불확실한 재시도'에는 재사용하고, 확인된 실행 이후에만 새로 발급해
// 응답 유실 후 재클릭이 중복 유료 실행이 되지 않게 한다(설계 §5.4·§11, 리뷰 지적 1).
// 쓰기 권한(canWrite)·시장(naver=ko-KR 한정)은 UI 선제 가드이고, 서버가 최종 강제한다.
'use client';

import { useRef, useState } from 'react';
import type { Market } from '@/types/visibility';
import type { SeoAuditDTO, SeoEngine, AuditMode } from '@/types/seo';
import { ENGINE_LABELS, MODE_LABELS, SEO_ENGINES } from '../constants';
import { SeoApiError, type RunAuditBody } from '../api';
import { useRunAudit, useResumeAudit } from '../hooks/use-seo-audit';

interface Props {
  domainId: string;
  market: Market;
  canWrite: boolean;
  /** 진행 중/부분 완료로 재개 가능한 현재 실행(없으면 null) */
  resumable: SeoAuditDTO | null;
  /** 실행/재개 결과 반영 — page 가 활성 auditId 를 추적한다 */
  onAudit: (audit: SeoAuditDTO) => void;
}

const GATE_TITLE = 'Starter 플랜부터 사용할 수 있습니다';

function msgOf(err: unknown): string {
  if (err instanceof SeoApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '요청을 처리하지 못했습니다';
}

/** 입력 경로 정규화: 줄바꿈/쉼표 분리, '/'로 시작하는 1~5개만 (서버가 최종 검증) */
function parsePaths(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function AuditRunPanel({ domainId, market, canWrite, resumable, onAudit }: Props) {
  const runM = useRunAudit();
  const resumeM = useResumeAudit(domainId);
  const [mode, setMode] = useState<AuditMode>('instant');
  const [engines, setEngines] = useState<SeoEngine[]>(['google']);
  const [pathsText, setPathsText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 멱등 재시도용: 직전 시도의 입력 서명과 runKey. 같은 입력의 불확실한 재시도엔 같은 키를,
  // 확인된 실행 뒤(onAudit 성공)엔 null 로 비워 다음 실행에 새 키를 발급한다(리뷰 지적 1).
  const attemptRef = useRef<{ signature: string; runKey: string } | null>(null);

  const naverAllowed = market === 'ko-KR';
  const busy = runM.isPending || resumeM.isPending;

  const toggleEngine = (en: SeoEngine) => {
    if (en === 'naver' && !naverAllowed) return;
    setEngines((prev) => (prev.includes(en) ? prev.filter((e) => e !== en) : [...prev, en]));
  };

  const handleRun = async () => {
    if (!canWrite || busy) return;
    setError(null);
    const paths = parsePaths(pathsText);
    const body: RunAuditBody = { domainId, runKey: '', mode };
    if (paths.length) body.paths = paths;
    if (engines.length) body.engines = engines;

    // 입력 서명이 직전 시도와 같으면(=결과 불확실한 재시도) 같은 runKey 재사용, 아니면 새로 발급.
    const signature = JSON.stringify({ domainId, mode, paths, engines });
    if (attemptRef.current?.signature === signature) {
      body.runKey = attemptRef.current.runKey;
    } else {
      body.runKey = crypto.randomUUID();
      attemptRef.current = { signature, runKey: body.runKey };
    }

    try {
      const audit = await runM.mutateAsync(body);
      attemptRef.current = null; // 확인된 실행 → 다음 클릭은 새 실행(새 키)
      onAudit(audit);
    } catch (err) {
      // 실패/유실 → attemptRef 보존해 같은 입력 재시도 시 같은 키로 재조회되게 둔다.
      setError(msgOf(err));
    }
  };

  const handleResume = async () => {
    if (!canWrite || busy || !resumable) return;
    setError(null);
    try {
      const audit = await resumeM.mutateAsync(resumable.id);
      onAudit(audit);
    } catch (err) {
      setError(msgOf(err));
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
        <span className="card-title">새 전체 진단 실행</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 전체 진단 범위 안내 (설계 §8, 리뷰 지적 3) */}
        <p style={{ fontSize: 10.5, color: 'var(--sub)', lineHeight: 1.6 }}>
          이 실행은 <strong style={{ color: 'var(--text)' }}>전체 진단</strong>입니다 — 기술 감사(아래 모드·경로 기준),
          키워드 발견·수요 수집, 자동 후보 키워드 순위까지 함께 진행합니다. 수집 페이지·리서치·순위 조합 상한은
          서버 정책으로 제한되며, 중단 시 아래 ‘재개’로 이어서 진행할 수 있습니다.
        </p>

        {/* 수집 모드 */}
        <div>
          <p id="seo-mode-label" style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600, marginBottom: 6 }}>기술 감사 수집 모드</p>
          <div role="group" aria-labelledby="seo-mode-label" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(Object.keys(MODE_LABELS) as AuditMode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                disabled={busy}
                style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                  border: `1px solid ${mode === m ? 'var(--blue-500)' : 'var(--border)'}`,
                  background: mode === m ? 'var(--blue-500)' : 'var(--surface)',
                  color: mode === m ? '#fff' : 'var(--text)',
                }}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 6 }}>
            {mode === 'crawl'
              ? '여러 페이지를 크롤합니다(상한은 서버 정책으로 결정). 비용·소요가 더 큽니다.'
              : '대표 URL 1개(또는 지정 경로)만 즉시 수집합니다. JS 렌더링 미포함 — 정적 HTML 기준.'}
          </p>
        </div>

        {/* 순위 수집 엔진 */}
        <div>
          <p id="seo-engine-label" style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600, marginBottom: 6 }}>순위 수집 엔진</p>
          <div role="group" aria-labelledby="seo-engine-label" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SEO_ENGINES.map((en) => {
              const on = engines.includes(en);
              const disabled = busy || (en === 'naver' && !naverAllowed);
              return (
                <button
                  key={en}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleEngine(en)}
                  disabled={disabled}
                  title={en === 'naver' && !naverAllowed ? '네이버는 한국(ko-KR) 시장에서만 지원됩니다' : undefined}
                  style={{
                    padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
                    border: `1px solid ${on ? 'var(--blue-500)' : 'var(--border)'}`,
                    background: on ? 'var(--blue-500)' : 'var(--surface)',
                    color: on ? '#fff' : 'var(--text)',
                    opacity: disabled && !on ? 0.5 : 1,
                  }}
                >
                  {ENGINE_LABELS[en]}
                </button>
              );
            })}
          </div>
          {!naverAllowed && (
            <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 6 }}>네이버 순위는 한국(ko-KR) 시장에서만 수집됩니다.</p>
          )}
        </div>

        {/* 대표 경로(선택) */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600 }}>대표 경로 (선택 · 최대 5개, 쉼표/줄바꿈 구분)</span>
          <textarea
            value={pathsText}
            onChange={(e) => setPathsText(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="예: /, /pricing, /blog"
            style={{ borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, padding: '7px 10px', fontFamily: 'inherit', resize: 'vertical' }}
          />
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>비우면 등록 호스트의 HTTPS 루트를 기준으로 진단합니다.</span>
        </label>

        {/* 비용 경고 (설계 §8: 새 진단 버튼만 비용 발생 명시) */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', borderRadius: 7, background: 'var(--amber-100)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber-700)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p style={{ fontSize: 11, color: 'var(--amber-700)' }}>
            실행 시 외부 수집 비용이 발생하며 월 진단 한도에서 차감됩니다. 조회 화면은 과금되지 않습니다.
          </p>
        </div>

        {error && <p role="alert" style={{ fontSize: 11.5, color: '#dc2626' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ opacity: canWrite ? 1 : 0.5 }}
            disabled={!canWrite || busy}
            title={canWrite ? undefined : GATE_TITLE}
            onClick={handleRun}
          >
            {runM.isPending ? '실행 중…' : '진단 실행'}
          </button>
          {resumable && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ opacity: canWrite ? 1 : 0.5 }}
              disabled={!canWrite || busy}
              title={canWrite ? '중단·대기 중인 작업을 이어서 진행합니다(과금 가능)' : GATE_TITLE}
              onClick={handleResume}
            >
              {resumeM.isPending ? '재개 중…' : '진행 중 실행 재개'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
