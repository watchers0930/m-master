// app/(dashboard)/ads/components/ProposalGroupEditor.tsx
// 제안의 광고그룹 1개 편집(Task 12): 그룹 이름·기본 입찰, 키워드(문구·입찰·삭제, 근거 표시), 소재(제목·설명·삭제).
// 린트 위반은 해당 칸 바로 아래에 표시한다. 저장하면 서버가 린트·입찰 상한을 다시 검사한다(화면은 검사하지 않는다).
// 입찰 칸 옆에 서버가 보낸 허용 범위(DTO bidRange — invariants.ts 천장 함수)를 보여 주고 max 로 건다(공식은 복제하지 않는다).
// 개수 하한(키워드 ≥ 1, 소재 ≥ 1)은 서버 스키마와 같게 삭제 버튼을 잠근다.
'use client';

import type { AdProposalDTO, ProposalGroup, ProposalLintIssue } from '@/types/ads';
import { bidRangeLabel, formatCount, issuesFor } from '@/lib/api/ads-format';
import { inputStyle, labelStyle, subText, tableStyle, tdStyle, thStyle } from './ui';

function Issues({ list }: { list: ProposalLintIssue[] }) {
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
      {list.map((i, n) => <span key={n} style={{ fontSize: 12, color: '#b91c1c' }}>위반 · {i.message}</span>)}
    </div>
  );
}

const num = (v: string) => (v === '' ? 0 : Number(v));
type BidRange = AdProposalDTO['bidRange'];

function BidRangeHint({ range }: { range: BidRange }) {
  return <span style={{ fontSize: 12, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{bidRangeLabel(range)}</span>;
}

export function ProposalGroupEditor({ index, group, issues, editable, bidRange, onChange }: {
  index: number; group: ProposalGroup; issues: ProposalLintIssue[]; editable: boolean; bidRange: BidRange; onChange: (g: ProposalGroup) => void;
}) {
  const setKeyword = (k: number, patch: Partial<ProposalGroup['keywords'][number]>) =>
    onChange({ ...group, keywords: group.keywords.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const setCreative = (c: number, patch: Partial<ProposalGroup['creatives'][number]>) =>
    onChange({ ...group, creatives: group.creatives.map((x, i) => (i === c ? { ...x, ...patch } : x)) });
  const groupIssues = issues.filter((i) => i.group === index).length;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
        <label style={labelStyle}>
          광고그룹 {index + 1} 이름
          <input value={group.name} maxLength={40} disabled={!editable} onChange={(e) => onChange({ ...group, name: e.target.value })} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          그룹 기본 입찰(원)
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input type="number" min={bidRange?.min ?? 70} max={bidRange?.max} step={10} value={group.bidAmt} disabled={!editable} onChange={(e) => onChange({ ...group, bidAmt: num(e.target.value) })} style={inputStyle} />
            <BidRangeHint range={bidRange} />
          </div>
        </label>
        <span style={{ ...subText, color: groupIssues > 0 ? '#b91c1c' : 'var(--sub)' }}>이 그룹 위반 {groupIssues}건</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr><th style={thStyle}>키워드</th><th style={thStyle}>입찰(원)</th><th style={thStyle}>근거(월 조회수 · 경쟁)</th><th style={thStyle}>이유</th><th style={thStyle} /></tr>
          </thead>
          <tbody>
            {group.keywords.map((k, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, minWidth: 160 }}>
                  <input value={k.keyword} maxLength={100} disabled={!editable} onChange={(e) => setKeyword(i, { keyword: e.target.value })} style={inputStyle} />
                  <Issues list={issuesFor(issues, index, 'keyword', i)} />
                </td>
                <td style={{ ...tdStyle, width: 130 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input type="number" min={bidRange?.min ?? 70} max={bidRange?.max} step={10} value={k.bidAmt} disabled={!editable} onChange={(e) => setKeyword(i, { bidAmt: num(e.target.value) })} style={inputStyle} />
                    <BidRangeHint range={bidRange} />
                  </div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {k.evidence.lt10 ? '10 미만' : k.evidence.qc === null ? '—' : formatCount(k.evidence.qc)} · {k.evidence.compIdx ?? '—'}
                </td>
                <td style={{ ...tdStyle, color: 'var(--sub)', minWidth: 160 }}>{k.reason}</td>
                <td style={{ ...tdStyle, width: 60 }}>
                  {editable && (
                    <button type="button" className="btn btn-ghost" disabled={group.keywords.length <= 1}
                      onClick={() => onChange({ ...group, keywords: group.keywords.filter((_, n) => n !== i) })}>삭제</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sub)' }}>소재(파워링크 제목·설명)</span>
        {group.creatives.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr) auto', gap: 10, alignItems: 'start' }}>
            <label style={labelStyle}>
              제목 · {c.headline.length}자
              <input value={c.headline} maxLength={200} disabled={!editable} onChange={(e) => setCreative(i, { headline: e.target.value })} style={inputStyle} />
              <Issues list={issuesFor(issues, index, 'creative', i, 'headline')} />
            </label>
            <label style={labelStyle}>
              설명 · {c.description.length}자
              <input value={c.description} maxLength={200} disabled={!editable} onChange={(e) => setCreative(i, { description: e.target.value })} style={inputStyle} />
              <Issues list={issuesFor(issues, index, 'creative', i, 'description')} />
            </label>
            <div style={{ paddingTop: 20 }}>
              {editable && (
                <button type="button" className="btn btn-ghost" disabled={group.creatives.length <= 1}
                  onClick={() => onChange({ ...group, creatives: group.creatives.filter((_, n) => n !== i) })}>삭제</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
