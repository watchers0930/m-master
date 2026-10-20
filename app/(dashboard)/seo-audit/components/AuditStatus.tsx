// app/(dashboard)/seo-audit/components/AuditStatus.tsx
// 현재 실행의 진행·부분 실패·복구 안내 + 세부 작업(operation) 상태.
// 설계 §8: pending/partial/failed·미지원/미측정/범위 내 미발견/오래된 결과를 구분해 보여준다.
// 폴링이 상한(10회)에 도달하면 수동 확인(재개/새로고침)으로 전환 안내한다(§1.3).
'use client';

import type { SeoAuditDTO } from '@/types/seo';
import { AUDIT_STATUS_META, OPERATION_LABELS, formatDateTime } from '../constants';

const TASK_LABEL: Record<string, string> = {
  pending: '대기',
  claimed: '실행 대기',
  partial: '부분 완료',
  skipped: '생략됨',
  submitted: '제출됨',
  completed: '완료',
  failed: '실패',
  uncertain: '확인 필요',
};

const TASK_COLOR: Record<string, string> = {
  pending: 'var(--amber-700)',
  claimed: 'var(--blue-400)',
  partial: 'var(--orange-400)',
  skipped: 'var(--text-muted)',
  submitted: 'var(--blue-400)',
  completed: 'var(--green-700)',
  failed: '#dc2626',
  uncertain: '#dc2626',
};

interface Props {
  audit: SeoAuditDTO;
  /** pending 폴링이 상한에 도달했는지(수동 확인 안내) */
  pollExhausted: boolean;
  /** 무과금 상세 GET 재조회 + 폴링 세션 재시작 */
  onManualCheck?: () => void;
  /** 재조회 진행 중 */
  manualChecking?: boolean;
}

export function AuditStatus({ audit, pollExhausted, onManualCheck, manualChecking }: Props) {
  const meta = AUDIT_STATUS_META[audit.status];
  const uncertain = audit.tasks.filter((t) => t.status === 'uncertain');
  const failed = audit.tasks.filter((t) => ['failed', 'partial', 'skipped'].includes(t.status));
  const failedUrls = audit.tasks.flatMap((t) => t.failedUrls ?? []);

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
        </svg>
        <span className="card-title">진단 진행 상태</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 5, padding: '2px 8px' }}>
          {meta.label}
        </span>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, color: 'var(--sub)' }}>
          <span>실행 {formatDateTime(audit.createdAt)}</span>
          {audit.completedAt && <span>· 완료 {formatDateTime(audit.completedAt)}</span>}
          <span>· 비용 {audit.costKrw.toLocaleString('ko-KR')}원</span>
        </div>

        {audit.status === 'pending' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <p role="status" style={{ fontSize: 11.5, color: 'var(--amber-700)', margin: 0 }}>
              {pollExhausted
                ? '자동 갱신이 멈췄습니다(수집이 길어짐). 아래 작업을 재개하거나 지금 확인을 눌러 다시 조회하세요.'
                : '외부 수집을 진행 중입니다. 결과가 들어오면 자동으로 갱신됩니다.'}
            </p>
            {onManualCheck && (
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }} disabled={manualChecking} onClick={onManualCheck} title="조회만 수행하며 과금되지 않습니다">
                {manualChecking ? '확인 중…' : '지금 확인'}
              </button>
            )}
          </div>
        )}

        {audit.status === 'partial' && (
          <p role="status" style={{ fontSize: 11.5, color: 'var(--amber-700)' }}>
            일부 작업만 완료되었습니다. 성공한 결과는 아래에 표시되며, 실패·미확인 작업은 재개할 수 있습니다.
          </p>
        )}

        {audit.status === 'failed' && (
          <p role="alert" style={{ fontSize: 11.5, color: '#dc2626' }}>
            {audit.failReason ?? '모든 작업이 실패했습니다. 입력·플랜·예산을 확인한 뒤 다시 실행하세요.'}
          </p>
        )}

        {uncertain.length > 0 && (
          <p role="alert" style={{ fontSize: 11, color: '#dc2626' }}>
            제출 상태가 불확실한 작업 {uncertain.length}건이 있습니다. 중복 과금 방지를 위해 자동 재시도하지 않으며, 공급자 작업 이력과 대조가 필요합니다.
          </p>
        )}

        {failedUrls.length > 0 && (
          <div role="status" style={{ fontSize: 11, color: 'var(--amber-700)' }}>
            수집 실패 URL
            <ul style={{ paddingLeft: 16 }}>{failedUrls.map((url) => <li key={url}>{url}</li>)}</ul>
          </div>
        )}

        {/* 세부 작업 상태 (민감필드 제외) */}
        {audit.tasks.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {audit.tasks.map((t, i) => (
              <span
                key={`${t.operation}:${t.itemKey}:${i}`}
                title={t.failReason ?? undefined}
                style={{ fontSize: 10, fontWeight: 600, color: TASK_COLOR[t.status] ?? 'var(--sub)', background: 'var(--n100)', borderRadius: 5, padding: '2px 7px' }}
              >
                {OPERATION_LABELS[t.operation] ?? t.operation} · {TASK_LABEL[t.status] ?? t.status}
              </span>
            ))}
          </div>
        )}

        {failed.length > 0 && failed.some((t) => t.failReason) && (
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {failed.filter((t) => t.failReason).map((t, i) => (
              <li key={i} style={{ fontSize: 10.5, color: 'var(--sub)' }}>
                {OPERATION_LABELS[t.operation] ?? t.operation}: {t.failReason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
