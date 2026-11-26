// app/(dashboard)/ads/components/ExtensionsCard.tsx
// 적용된 제안의 광고그룹별 확장소재(3.6단계): 펼치면 네이버 현황(대장이 직접 만든 것 포함)을 1번 읽고, 'AI 초안' → 편집 → 등록.
// 광고그룹 목록은 계정 개요(DB 미러, ProposalEntities와 같은 쿼리 캐시)에서 이 제안의 것만 고른다. 이미지 확장소재는 안내만(ImageGuide).
'use client';

import { useState } from 'react';
import { errorView, inspectLabel } from '@/lib/api/ads-format';
import { useAdsOverview } from '@/hooks/useAdsOverview';
import { useDraftExtensions, useGroupExtensions, useReleaseExtension } from '@/hooks/useAdExtensions';
import type { AdMirrorGroupDTO } from '@/types/ads';
import { ExtensionEditor } from './ExtensionEditor';
import { ImageGuide } from './ImageGuide';
import { Card, Empty, Notice, subText } from './ui';

const TYPE_LABEL: Record<string, string> = { HEADLINE: '추가제목', DESCRIPTION: '홍보문구', SUB_LINKS: '서브링크' };

function GroupPanel({ group }: { group: AdMirrorGroupDTO }) {
  const current = useGroupExtensions(group.id, true);
  const draft = useDraftExtensions(group.id);
  const release = useReleaseExtension(group.id);
  const list = current.data?.extensions ?? [];
  const pending = current.data?.pending ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px 16px' }}>
      {current.isPending ? <span style={subText}>네이버에서 확장소재를 읽는 중…</span>
        : current.error ? <Notice view={errorView(current.error)} />
        : list.length === 0 ? <span style={subText}>이 광고그룹에는 확장소재가 없습니다.</span>
        : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            {list.map((e) => (
              <li key={e.naverId}>{e.summary} <span style={subText}>· 검수 {inspectLabel(e.inspectStatus)}{e.mine ? ' · MINTEQ가 만듦' : ''}</span></li>
            ))}
          </ul>
        )}
      {pending.map((p) => (
        <div key={p.type} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Notice tone="warn" view={{ message: p.stale
            ? `${TYPE_LABEL[p.type] ?? p.type} 등록이 반영됐는지 확인되지 않은 채 멈췄습니다. 네이버 광고 화면에 없으면 '다시 확인'을 누르세요(있으면 그대로 연결, 없으면 다시 등록할 수 있게 풉니다).`
            : `${TYPE_LABEL[p.type] ?? p.type} 등록이 진행 중입니다.`, urgent: false, reload: false }} />
          {p.stale && <button type="button" className="btn btn-ghost" disabled={release.isPending} onClick={() => release.mutate(p.type)}>다시 확인</button>}
        </div>
      ))}
      {release.error && <Notice view={errorView(release.error)} />}
      {!draft.data && (
        <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={draft.isPending} onClick={() => draft.mutate()}>
          {draft.isPending ? 'AI 초안 만드는 중…' : 'AI로 텍스트 확장소재 초안 만들기'}
        </button>
      )}
      {draft.error && <Notice view={errorView(draft.error)} />}
      {draft.data && <ExtensionEditor groupId={group.id} initial={draft.data} />}
    </div>
  );
}

export function ExtensionsCard({ proposalId, accountId }: { proposalId: string; accountId: string }) {
  const overview = useAdsOverview(accountId);
  const [open, setOpen] = useState<string | null>(null);
  if (overview.isPending || overview.error) return null; // 개요 오류는 ProposalEntities가 보인다
  const groups = overview.data.groups.filter((g) => g.proposalId === proposalId);
  return (
    <Card title="확장소재(추가제목·홍보문구·서브링크)" right={<span style={subText}>그룹이 켜져 있을 때 광고와 함께 노출 · 자체 비용 없음</span>} bodyStyle={{ padding: 0, gap: 0 }}>
      {groups.length === 0 ? <Empty>광고그룹이 없습니다.</Empty> : groups.map((g) => (
        <div key={g.id} style={{ borderTop: '1px solid var(--border2)' }}>
          <button type="button" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, padding: '12px 16px' }}
            aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
            <span>{g.name}</span><span style={subText}>{open === g.id ? '접기' : '펼치기'}</span>
          </button>
          {open === g.id && <GroupPanel group={g} />}
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--border2)', padding: 16 }}><ImageGuide /></div>
    </Card>
  );
}
