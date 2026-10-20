// app/(dashboard)/seo-audit/components/TechnicalChecklist.tsx
// 15항목 기술 체크 근거·영향 URL·개선 권고. 설계 §4.2·§3.
// unknown/n/a 는 '위반'으로 표현하지 않는다(근거 부족·해당 없음). affectedUrls 는 ≤20, 텍스트로만 렌더.
'use client';

import { useState } from 'react';
import type { SeoCheckResult, CheckStatus } from '@/types/seo';
import { CHECK_STATUS_META } from '../constants';

/** 상태 정렬 우선순위: 문제부터 위로(fail→warning→unknown→pass→n/a) */
const STATUS_ORDER: Record<CheckStatus, number> = {
  fail: 0,
  warning: 1,
  unknown: 2,
  pass: 3,
  not_applicable: 4,
};

function StatusBadge({ status }: { status: CheckStatus }) {
  const meta = CHECK_STATUS_META[status];
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 4, padding: '2px 7px', flexShrink: 0 }}>
      {meta.label}
    </span>
  );
}

function CheckRow({ c }: { c: SeoCheckResult }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    !!c.recommendation || c.affectedUrls.length > 0 || (c.subFindings && c.subFindings.length > 0);
  const detailId = `seo-check-detail-${c.key}`;

  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)' }}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        aria-controls={hasDetail ? detailId : undefined}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: hasDetail ? 'pointer' : 'default', textAlign: 'left' }}
      >
        <StatusBadge status={c.status} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>{c.label}</span>
        <span style={{ fontSize: 10, color: 'var(--sub)', flexShrink: 0 }}>
          가중치 {c.weight}
          {c.evaluatedSamples > 0 && ` · 표본 ${c.evaluatedSamples}${c.failedSamples > 0 ? ` (문제 ${c.failedSamples})` : ''}`}
        </span>
        {hasDetail && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {c.detail && (
        <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 6, marginLeft: 0 }}>{c.detail}</p>
      )}

      {open && hasDetail && (
        <div id={detailId} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {c.subFindings && c.subFindings.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {c.subFindings.map((f, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text)' }}>
                  <StatusBadge status={f.status} /> {f.label}
                </span>
              ))}
            </div>
          )}

          {c.recommendation && (
            <p style={{ fontSize: 11, color: 'var(--text)', background: 'var(--n100)', borderRadius: 6, padding: '8px 10px' }}>
              💡 {c.recommendation}
            </p>
          )}

          {c.affectedUrls.length > 0 && (
            <div>
              <p style={{ fontSize: 10, color: 'var(--sub)', marginBottom: 4 }}>영향 URL (최대 20)</p>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {c.affectedUrls.slice(0, 20).map((u, i) => {
                  const safe = /^https?:\/\//i.test(u);
                  return (
                    <li key={i} style={{ fontSize: 10.5, color: 'var(--sub)', wordBreak: 'break-all' }}>
                      {safe ? (
                        <a href={u} target="_blank" rel="noopener noreferrer nofollow" style={{ color: 'var(--blue-400)' }}>{u}</a>
                      ) : (
                        u
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TechnicalChecklist({ checks }: { checks: SeoCheckResult[] }) {
  const sorted = [...checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.weight - a.weight);

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
        <span className="card-title">기술 체크리스트</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>{checks.length}개 항목</span>
      </div>

      {checks.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '32px 0' }}>
          기술 감사 결과가 아직 없습니다
        </p>
      ) : (
        sorted.map((c) => <CheckRow key={c.key} c={c} />)
      )}
    </div>
  );
}
