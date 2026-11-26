// app/(dashboard)/ads/components/ExtensionEditor.tsx
// 확장소재 초안 편집·등록(3.6단계). 글자 수 표시는 안내용이고, 기준 판정(15·14·6자·'·'·서브링크 3~4개·같은 사이트·열리는 주소)은 서버가 한다.
// 빈 칸 = 그 유형은 만들지 않음. 등록 = 대장 승인(확인창). 결과는 유형별로 보여 준다.
'use client';

import { useId, useState } from 'react';
import { errorView } from '@/lib/api/ads-format';
import { useApplyExtensions } from '@/hooks/useAdExtensions';
import type { AdExtensionApplyDTO, AdExtensionDraftDTO, AdSubLinkDraft } from '@/types/ads';
import { Notice, inputStyle, labelStyle, subText } from './ui';

const RESULT: Record<string, string> = { created: '등록됨(네이버 검수 대기)', exists: '이미 있음(그대로 둠)', limit: '그룹 한도(유형별 2개) 초과로 건너뜀', rejected: '네이버가 거절' };
const TYPE: Record<string, string> = { HEADLINE: '추가제목', DESCRIPTION: '홍보문구', SUB_LINKS: '서브링크' };
const len = (s: string) => Array.from(s.normalize('NFC').trim()).length;
const Count = ({ value, max }: { value: string; max: number }) => (
  <span style={{ fontWeight: 400, color: len(value) > max ? 'var(--red-700, #b91c1c)' : 'var(--sub)' }}>{len(value)}/{max}자</span>
);

export function ExtensionEditor({ groupId, initial }: { groupId: string; initial: AdExtensionDraftDTO }) {
  const apply = useApplyExtensions(groupId);
  const listId = useId();
  const [headline, setHeadline] = useState(initial.draft.headline ?? '');
  const [promo, setPromo] = useState(initial.draft.promo ?? '');
  const [links, setLinks] = useState<AdSubLinkDraft[]>(initial.draft.subLinks ?? []);
  const [result, setResult] = useState<AdExtensionApplyDTO | null>(null);
  const setLink = (i: number, patch: Partial<AdSubLinkDraft>) => setLinks(links.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const issues = initial.issues;
  const submit = () => {
    const subLinks = links.filter((l) => l.name.trim() || l.url.trim());
    const kinds = [headline.trim() && '추가제목', promo.trim() && '홍보문구', subLinks.length && `서브링크 ${subLinks.length}개`].filter(Boolean).join(' · ');
    if (!kinds) return;
    if (!confirm(`이 광고그룹에 ${kinds}를 등록합니다. 네이버 검수 후 광고그룹이 켜져 있을 때 광고와 함께 노출됩니다. 계속할까요?`)) return;
    setResult(null);
    apply.mutate({ headline, promo, subLinks }, { onSuccess: setResult });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {issues.length > 0 && <Notice tone="warn" view={{ message: `AI 초안에 남은 기준 위반 ${issues.length}건: ${issues.slice(0, 3).map((i) => i.message).join(' / ')}`, urgent: false, reload: false }} />}
      <label style={labelStyle}>
        <span>추가제목 <Count value={headline} max={15} /></span>
        <input style={inputStyle} value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} placeholder="비우면 만들지 않습니다" />
      </label>
      <label style={labelStyle}>
        <span>홍보문구 <Count value={promo} max={14} /></span>
        <input style={inputStyle} value={promo} maxLength={60} onChange={(e) => setPromo(e.target.value)} placeholder="비우면 만들지 않습니다 · 가운뎃점(·) 불가" />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...labelStyle, flexDirection: 'row' }}>서브링크 3~4개 · 이름 6자 · {initial.landingHost} 안의 페이지만</span>
        {links.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inputStyle, width: 120 }} value={l.name} maxLength={30} onChange={(e) => setLink(i, { name: e.target.value })} placeholder="이름" aria-label={`서브링크 ${i + 1} 이름`} />
            <Count value={l.name} max={6} />
            <input style={{ ...inputStyle, flex: 1, minWidth: 220 }} list={listId} value={l.url} maxLength={500} inputMode="url"
              onChange={(e) => setLink(i, { url: e.target.value })} placeholder={`https://${initial.landingHost}/...`} aria-label={`서브링크 ${i + 1} 주소`} />
            <button type="button" className="btn btn-ghost" onClick={() => setLinks(links.filter((_, n) => n !== i))}>빼기</button>
          </div>
        ))}
        <datalist id={listId}>
          {initial.pages.map((p) => <option key={p.url} value={p.url}>{p.title ?? p.url}</option>)}
        </datalist>
        {links.length < 4 && (
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}
            onClick={() => setLinks([...links, { name: '', url: '' }])}>서브링크 추가</button>
        )}
        {initial.pages.length === 0 && <span style={subText}>사이트맵(sitemap.xml)에서 페이지를 찾지 못했습니다. 광고 사이트 안의 주소를 직접 넣으세요(등록 전에 열리는지 서버가 확인합니다).</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={apply.isPending} onClick={submit}>{apply.isPending ? '등록 중…' : '네이버에 등록'}</button>
        <span style={subText}>AI 초안 비용 {initial.costKrw.toLocaleString('ko-KR')}원</span>
      </div>
      {apply.error && <Notice view={errorView(apply.error)} />}
      {result && (
        <Notice tone={result.outcomes.some((o) => o.result === 'rejected') ? 'warn' : 'ok'} view={{
          message: result.outcomes.map((o) => `${TYPE[o.type] ?? o.type}: ${RESULT[o.result] ?? o.result}${o.naverCode ? `(네이버 코드 ${o.naverCode})` : ''}`).join(' · '),
          urgent: false, reload: false,
        }} />
      )}
    </div>
  );
}
