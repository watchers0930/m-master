// app/(dashboard)/ads/components/ProposalEstimate.tsx
// 제안 키워드의 순위별 예상 입찰가(B4). '예상 순위 조회'를 눌렀을 때만 서버를 부른다(페이지 로드 때 부르지 않는다).
// 키워드 옆에 'PC 약 N위 · 모바일 약 M위', 그 아래 줄에 1~5위 예상 입찰가. 허용 범위(DTO bidRange.max)를 넘는 값은 '(상한 초과)'로
// 그대로 보여 준다 — 판정은 exceedsBidRange 하나(lib/api/ads-format.ts). 입찰은 자동으로 바꾸지 않는다(대장이 아래 편집기에서 직접).
'use client';

import { errorView, expectedSummary, formatKrw, positionBidsLabel } from '@/lib/api/ads-format';
import { useAdsProposalEstimate } from '@/hooks/useAdsProposal';
import type { ProposalEstimateDTO } from '@/types/ads';
import { Card, Empty, Notice, info, subText, tableStyle, tdStyle, thStyle } from './ui';

function EstimateTable({ data }: { data: ProposalEstimateDTO }) {
  if (data.rows.length === 0) return <Empty>조회할 키워드가 없습니다.</Empty>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr><th style={thStyle}>키워드</th><th style={thStyle}>저장된 입찰</th><th style={thStyle}>예상 순위 · 순위별 예상 입찰가</th></tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={`${r.keyword}-${i}`}>
              <td style={{ ...tdStyle, minWidth: 140 }}>{r.keyword}</td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatKrw(r.bid)}</td>
              <td style={{ ...tdStyle, minWidth: 280 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <b style={{ fontSize: 13 }}>{expectedSummary(r.expected)}</b>
                  <span style={subText}>PC: {positionBidsLabel(r.PC, data.bidRange)}</span>
                  <span style={subText}>모바일: {positionBidsLabel(r.MOBILE, data.bidRange)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProposalEstimate({ proposalId, dirty }: { proposalId: string; dirty: boolean }) {
  const estimate = useAdsProposalEstimate(proposalId);
  const button = (
    <button type="button" className="btn btn-ghost" disabled={estimate.isPending} onClick={() => estimate.mutate()}>
      {estimate.isPending ? '조회 중…' : '예상 순위 조회'}
    </button>
  );
  return (
    <Card title="예상 순위(네이버 추정)" right={button}>
      <div style={subText}>
        네이버가 추정한 순위별 평균 입찰가로 저장된 입찰의 예상 순위를 보여 줍니다(조회만 — 비용·변경 없음, 같은 제안은 1분에 한 번).
        실제 순위는 품질지수·경쟁에 따라 달라집니다.
      </div>
      {dirty && <Notice view={info('저장하지 않은 입찰 변경은 반영되지 않습니다. 저장한 뒤 다시 조회하세요.')} tone="info" />}
      {estimate.isPending && <Empty>네이버에 예상 입찰가를 묻는 중…</Empty>}
      {estimate.error && <Notice view={errorView(estimate.error)} />}
      {estimate.data && !estimate.isPending && (
        <>
          <span style={subText}>조회 시각 {new Date(estimate.data.fetchedAt).toLocaleString('ko-KR')}</span>
          <EstimateTable data={estimate.data} />
        </>
      )}
    </Card>
  );
}
