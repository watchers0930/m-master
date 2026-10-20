// app/(dashboard)/consulting/components/ReportHeader.tsx
// 리포트 상단: 도메인·market·생성일·관측 범위·상태 배지 + "AI 전략 제안, 실행 전 검토" 고지 +
// 소스별 수집 상태(§3.1) + 한계(limitations). generating 이면 폴링/수동 확인 안내(§7).
// 수치는 서버 스냅샷에서 전달된 값만 표시하며 프론트는 재계산하지 않는다.
'use client';

import type { ConsultingReportDTO } from '../types';
import { STATUS_META, SOURCE_LABELS, SOURCE_STATUS_META, MARKET_LABELS, formatDateTime, formatDate } from '../constants';

interface Props {
  report: ConsultingReportDTO;
  domainUrl: string | null;
  pollExhausted: boolean;
  onManualCheck?: () => void;
  manualChecking?: boolean;
}

export function ReportHeader({ report, domainUrl, pollExhausted, onManualCheck, manualChecking }: Props) {
  const meta = STATUS_META[report.status];

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
        <span className="card-title">{domainUrl ?? '전략 리포트'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 5, padding: '2px 8px' }}>
          {meta.label}
        </span>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, color: 'var(--sub)' }}>
          <span>{MARKET_LABELS[report.market]}</span>
          <span>· 생성 {formatDateTime(report.generatedAt ?? report.createdAt)}</span>
          <span>· 관측 범위 {formatDate(report.range?.from)} ~ {formatDate(report.range?.to)}</span>
          <span>· {report.model}</span>
        </div>

        {/* AI 고지 (설계 §7) */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', borderRadius: 7, background: 'var(--n100)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          <p style={{ fontSize: 11, color: 'var(--sub)', lineHeight: 1.5 }}>
            AI가 생성한 전략 제안입니다. 수치는 저장된 진단 근거에서 인용되며, <strong style={{ color: 'var(--text)' }}>실행 전 반드시 검토</strong>하세요.
          </p>
        </div>

        {/* generating 안내 */}
        {report.status === 'generating' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <p role="status" style={{ fontSize: 11.5, color: 'var(--amber-700)', margin: 0 }}>
              {pollExhausted
                ? '자동 갱신이 멈췄습니다. 아래 ‘지금 확인’으로 다시 조회하세요.'
                : '전략을 생성 중입니다. 완료되면 자동으로 갱신됩니다.'}
            </p>
            {onManualCheck && (
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }} disabled={manualChecking} onClick={onManualCheck} title="조회만 수행하며 과금되지 않습니다">
                {manualChecking ? '확인 중…' : '지금 확인'}
              </button>
            )}
          </div>
        )}

        {/* 검증 실패 / 비용 미확정 */}
        {report.status === 'failed' && (
          <p role="alert" style={{ fontSize: 11.5, color: '#dc2626' }}>
            {report.failCode === 'request_rejected'
              ? '생성 요청이 실행 전에 거절되어 예약 예산을 해제했습니다. API 설정을 확인한 뒤 다시 생성할 수 있습니다.'
              : report.failCode === 'expired_unstarted'
                ? '시작 전에 작업이 만료되어 예약 예산을 해제했습니다. 다시 생성할 수 있습니다.'
                : '전략 검증에 실패했습니다. 기존 입력은 다시 호출하지 않습니다. 데이터를 보완한 뒤 생성하세요.'}
          </p>
        )}
        {report.status === 'uncertain' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <p role="alert" style={{ fontSize: 11.5, color: '#dc2626', margin: 0, flex: 1, minWidth: 200 }}>
              생성 비용이 미확정 상태입니다. 중복 과금 방지를 위해 자동 재시도하지 않으며, 운영자 정산 후 상태가 갱신됩니다. 새로 생성하지 말고 ‘지금 확인’으로 최신 상태를 조회하세요.
            </p>
            {onManualCheck && (
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', flexShrink: 0 }} disabled={manualChecking} onClick={onManualCheck} title="조회만 수행하며 과금되지 않습니다">
                {manualChecking ? '확인 중…' : '지금 확인'}
              </button>
            )}
          </div>
        )}

        {/* 소스별 수집 상태 (실제 관측 0 과 미수집 null 구분) */}
        {report.sourceStatus?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {report.sourceStatus.map((s, i) => {
              const sm = SOURCE_STATUS_META[s.status] ?? { label: s.status, color: 'var(--sub)' };
              const when = s.observedAt ? ` · ${formatDate(s.observedAt)}` : '';
              return (
                <span
                  key={`${s.source}:${i}`}
                  title={s.reason ?? undefined}
                  style={{ fontSize: 10, fontWeight: 600, color: sm.color, background: 'var(--n100)', borderRadius: 5, padding: '2px 7px' }}
                >
                  {SOURCE_LABELS[s.source] ?? s.source}: {sm.label}{when}
                </span>
              );
            })}
          </div>
        )}

        {/* 한계 (누락·오래된 데이터·부분 표본) */}
        {report.limitations?.length > 0 && (
          <div>
            <p style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600, marginBottom: 4 }}>분석 한계</p>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {report.limitations.map((l, i) => (
                <li key={i} style={{ fontSize: 10.5, color: 'var(--sub)' }}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
