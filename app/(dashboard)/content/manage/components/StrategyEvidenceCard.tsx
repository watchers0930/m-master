// 전략 근거 카드 — 이 글이 근거로 삼은 컨설팅 리포트 액션·관측 근거·기간·한계 (설계 §3.5·§6).
// GA4 내부 수치는 이 카드에만 표시한다(본문 미리보기에 주입 금지). 값은 서버가 만든 표시용 문자열 그대로.
import Link from 'next/link';
import type { StrategyContextDTO } from '@/types/content-review';

const PRIORITY_TONE: Record<StrategyContextDTO['priority'], { bg: string; color: string }> = {
  P0: { bg: '#fee2e2', color: '#b91c1c' },
  P1: { bg: 'var(--amber-100)', color: 'var(--amber-700)' },
  P2: { bg: 'var(--n100)', color: 'var(--sub)' },
};

/**
 * 컨설팅 화면은 (domainId, reportId) 쌍으로 리포트를 조회한다 — reportId 만 넘기면 마지막 선택 도메인 기준으로
 * 조회돼 다른 도메인의 리포트가 404 가 된다. 도메인을 알면 함께 넘긴다(consulting/page.tsx 딥링크 형식).
 */
function reportHref(ctx: StrategyContextDTO): string {
  const qs = new URLSearchParams();
  if (ctx.domain_id) qs.set('domainId', ctx.domain_id);
  qs.set('reportId', ctx.report_id);
  return `/consulting?${qs}`;
}

export default function StrategyEvidenceCard({ ctx }: { ctx: StrategyContextDTO }) {
  const tone = PRIORITY_TONE[ctx.priority] ?? PRIORITY_TONE.P2;
  return (
    <section aria-label="전략 근거" style={{ border: '1px solid #ddd6fe', background: '#faf5ff', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6d28d9' }}>전략 근거</span>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: tone.bg, color: tone.color }}>{ctx.priority}</span>
        <Link
          href={reportHref(ctx)}
          style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--blue-600)' }}
        >
          리포트 보기 →
        </Link>
      </div>

      <div>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{ctx.action_title}</p>
        {ctx.action_description && (
          <p style={{ fontSize: 11.5, color: 'var(--sub)', margin: '3px 0 0', lineHeight: 1.6 }}>{ctx.action_description}</p>
        )}
      </div>

      {ctx.evidence.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {ctx.evidence.map((e) => (
            <li key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
              <span style={{ color: 'var(--sub)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{e.value}</span>
            </li>
          ))}
        </ul>
      )}

      <p style={{ fontSize: 12, color: 'var(--sub)', margin: 0 }}>
        관측 기간 {ctx.range.from} ~ {ctx.range.to}
        {ctx.truncated ? ' · 근거 일부 생략' : ''}
      </p>

      {ctx.limitations.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ctx.limitations.map((l, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--sub)' }}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
