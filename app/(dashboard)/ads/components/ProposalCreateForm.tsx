// app/(dashboard)/ads/components/ProposalCreateForm.tsx
// AI 광고 제안 만들기(Task 12): 계정 · 종류(새 캠페인 | 기존 광고그룹 확장) · 씨앗 도메인(선택) · 수동 씨앗(≤ 25개, 각 ≤ 40자 — 서버도 검사).
// 생성은 키워드 도구 + AI(최대 3분, 비용 발생) — 진행 중에는 버튼을 잠근다. 월 예산 초과면 429 budget_exceeded(콘텐츠 생성과 같은 문구).
'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MAX_SEED_LENGTH, MAX_SEEDS, errorView, parseSeeds, type ErrorView } from '@/lib/api/ads-format';
import { useAdsOverview } from '@/hooks/useAdsOverview';
import { useCreateAdsProposal } from '@/hooks/useAdsProposals';
import { useOwnedDomains } from '@/hooks/useOwnedDomains';
import type { AdAccountDTO, AdProposalKind } from '@/types/ads';
import { Card, Notice, info, inputStyle, labelStyle, subText } from './ui';

const ready = (a: AdAccountDTO) => a.connected && a.status === 'active' && !!a.businessChannelId && !!a.sharedBudgetId;

export function ProposalCreateForm({ account }: { account: AdAccountDTO }) {
  const router = useRouter();
  const create = useCreateAdsProposal();
  const domains = useOwnedDomains();
  const [kind, setKind] = useState<AdProposalKind>('new_campaign');
  const [target, setTarget] = useState('');
  const [domainId, setDomainId] = useState('');
  const [seedText, setSeedText] = useState('');
  const [error, setError] = useState<ErrorView | null>(null);
  const overview = useAdsOverview(kind === 'extend_group' ? account.id : null); // 확장 대상 광고그룹 목록(DB만)
  const { seeds, error: seedError } = parseSeeds(seedText);
  const canSubmit = ready(account) && !seedError && (seeds.length > 0 || domainId !== '') && (kind === 'new_campaign' || target !== '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || create.isPending) return;
    setError(null);
    create.mutate(
      { accountId: account.id, kind, ...(kind === 'extend_group' ? { targetAdgroupId: target } : {}), ...(domainId ? { domainId } : {}), ...(seeds.length ? { seeds } : {}) },
      { onSuccess: (p) => router.push(`/ads/proposals/${p.id}`), onError: (err) => setError(errorView(err)) },
    );
  };

  return (
    <Card title="AI 광고 제안 만들기">
      {!ready(account) && <Notice view={info('계정이 연결·활성 상태이고 검수가 끝난 비즈채널이 선택돼 있어야 제안을 만들 수 있습니다. 계정 화면에서 비즈채널을 고르세요.')} tone="warn" />}
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <label style={labelStyle}>
          종류
          <select value={kind} onChange={(e) => setKind(e.target.value as AdProposalKind)} style={inputStyle} disabled={create.isPending}>
            <option value="new_campaign">새 캠페인</option>
            <option value="extend_group">기존 광고그룹 확장</option>
          </select>
        </label>
        {kind === 'extend_group' && (
          <label style={labelStyle}>
            확장할 광고그룹
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle} disabled={create.isPending}>
              <option value="">{overview.isPending ? '불러오는 중…' : '광고그룹 선택'}</option>
              {(overview.data?.groups ?? []).map((g) => <option key={g.id} value={g.naverId}>{g.name}</option>)}
            </select>
          </label>
        )}
        <label style={labelStyle}>
          씨앗 도메인(선택 — SEO·컨설팅 키워드를 씨앗으로)
          <select value={domainId} onChange={(e) => setDomainId(e.target.value)} style={inputStyle} disabled={create.isPending}>
            <option value="">사용 안 함</option>
            {(domains.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.url}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
          씨앗 키워드(쉼표·줄바꿈으로 구분, 최대 {MAX_SEEDS}개 · 각 {MAX_SEED_LENGTH}자)
          <textarea rows={3} value={seedText} onChange={(e) => setSeedText(e.target.value)} disabled={create.isPending} style={{ ...inputStyle, resize: 'vertical' }} />
          <span style={{ fontSize: 12, fontWeight: 400, color: seedError ? '#b91c1c' : 'var(--sub)' }}>{seedError ?? `${seeds.length}개`}</span>
        </label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'AI 제안 만드는 중(최대 3분)…' : '제안 만들기'}
          </button>
          <span style={subText}>{kind === 'extend_group' ? '확장은 대상 광고그룹과 그 캠페인이 네이버에서 꺼져 있어야 적용할 수 있습니다(4-1 제한).' : '만든 제안은 검토·승인한 뒤에만 네이버에 적용됩니다.'}</span>
        </div>
      </form>
      <Notice view={error} />
    </Card>
  );
}
