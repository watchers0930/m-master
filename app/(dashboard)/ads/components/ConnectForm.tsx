// app/(dashboard)/ads/components/ConnectForm.tsx
// 광고 계정 연결 폼(Task 12): 고객 ID · API 키 · 비밀키 · 라벨. 서버가 키를 네이버로 검증한 뒤에만 저장한다(실패면 저장 0).
// - 진행 중에는 버튼을 잠근다(빠른 두 번 클릭이 공유예산 mq-cap을 두 개 만들지 않게 — Task 5 m-2). 서버도 같은 고객ID는 한 행으로 합친다.
// - 키는 제출 직후(성공·실패 모두) 폼 상태에서 지우고, 끝나면 mutation 상태도 reset()한다. 화면에는 뒤 4자리만 다시 보인다.
'use client';

import { useState, type FormEvent } from 'react';
import { errorView, type ErrorView } from '@/lib/api/ads-format';
import { useAdsAccountMutations } from '@/hooks/useAdsAccounts';
import { EMPTY_KEYS, KeyFields, type KeyValues } from './KeyFields';
import { Card, Notice, info, inputStyle, labelStyle, subText } from './ui';

export function ConnectForm() {
  const { connect } = useAdsAccountMutations();
  const [customerId, setCustomerId] = useState('');
  const [label, setLabel] = useState('');
  const [keys, setKeys] = useState<KeyValues>(EMPTY_KEYS);
  const [notice, setNotice] = useState<{ view: ErrorView; ok: boolean } | null>(null);
  const ready = /^[1-9][0-9]{0,14}$/.test(customerId) && keys.apiKey.length >= 16 && keys.secretKey.length >= 16 && label.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || connect.isPending) return;
    const input = { customerId, label: label.trim(), apiKey: keys.apiKey, secretKey: keys.secretKey };
    setKeys(EMPTY_KEYS); // 제출 즉시 지운다
    setNotice(null);
    connect.mutate(input, {
      onSuccess: (r) => {
        setNotice({ view: info(`연결했습니다(키 끝 ${r.account.keyLast4}). 아래 계정 카드에서 검수가 끝난 비즈채널을 고르세요.`), ok: true });
        setCustomerId('');
        setLabel('');
      },
      onError: (err) => setNotice({ view: errorView(err), ok: false }),
      onSettled: () => connect.reset(), // 키가 든 변수를 mutation 상태에서 지운다(gcTime 0과 함께, B5)
    });
  };

  return (
    <Card title="광고 계정 연결">
      <form onSubmit={submit} autoComplete="off" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label style={labelStyle}>
          고객 ID(네이버 광고 계정 번호)
          <input inputMode="numeric" autoComplete="off" value={customerId} disabled={connect.isPending}
            onChange={(e) => setCustomerId(e.target.value.replace(/\D/g, '').slice(0, 15))} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          라벨(화면 표시용)
          <input maxLength={50} autoComplete="off" value={label} disabled={connect.isPending} onChange={(e) => setLabel(e.target.value)} style={inputStyle} />
        </label>
        <KeyFields value={keys} onChange={setKeys} disabled={connect.isPending} />
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={!ready || connect.isPending}>
            {connect.isPending ? '네이버에서 키 확인 중…' : '연결'}
          </button>
          <span style={subText}>키는 네이버 확인을 통과해야만 암호화해 저장합니다. 연결하면 하루 상한 10만 원 공유예산(mq-cap)을 확인·생성합니다.</span>
        </div>
      </form>
      {notice && <Notice view={notice.view} tone={notice.ok ? 'ok' : 'error'} />}
    </Card>
  );
}
