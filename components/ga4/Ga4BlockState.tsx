// components/ga4/Ga4BlockState.tsx
// GA4 블록 실패 상태 공용 안내 (설계 §2.4 표). 성공(ok)이 아닌 블록에서 값 자리를 대신한다.
// 규칙: error·미연결 상태에서 0·빈 차트를 그리지 않는다 — 호출부는 ok 일 때만 값을 렌더한다.
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Ga4Block, Ga4FailedBlock } from './types';
import { GA4_FAILURE_MESSAGES, ga4FailureText } from '@/lib/analytics/ga4-block-text';

// 문구 단일 출처는 lib/analytics/ga4-block-text.ts (컴포넌트 밖 소비처와 공유)
const MESSAGES = GA4_FAILURE_MESSAGES;

/** ok 면 render(data), 아니면 상태 안내. 호출부가 실패 블록에서 값을 그리는 실수를 구조적으로 막는다. */
export function Ga4BlockView<T>({
  block, render, domainSelect, onRetry,
}: { block: Ga4Block<T>; render: (data: T) => ReactNode; domainSelect?: ReactNode; onRetry?: () => void }) {
  if (block.state === 'ok') return <>{render(block.data)}</>;
  return <Ga4BlockState block={block} domainSelect={domainSelect} onRetry={onRetry} />;
}

interface Props {
  block: Ga4FailedBlock;
  /** domain_required 일 때 함께 보여줄 도메인 선택 UI */
  domainSelect?: ReactNode;
  /** retryable 오류일 때 다시 시도 */
  onRetry?: () => void;
  compact?: boolean;
}

export function Ga4BlockState({ block, domainSelect, onRetry, compact }: Props) {
  const isError = block.state === 'error';
  const color = isError ? '#b91c1c' : 'var(--sub)';

  if (compact) {
    return <span style={{ fontSize: 11, color }} title={ga4FailureText(block)}>{ga4FailureText(block)}</span>;
  }

  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '20px 12px', fontSize: 12, color, textAlign: 'center',
      }}
    >
      <span style={{ fontWeight: 600 }}>{MESSAGES[block.state]}</span>
      {isError && block.retryable && <span style={{ fontSize: 11, color: 'var(--sub)' }}>잠시 후 다시 시도해 주세요.</span>}
      {block.state === 'not_configured' && (
        <Link href="/settings" style={{ fontSize: 11.5, color: 'var(--blue-600)', fontWeight: 600 }}>설정에서 GA4 연결 확인</Link>
      )}
      {block.state === 'domain_required' && domainSelect}
      {isError && block.retryable && onRetry && (
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={onRetry}>다시 시도</button>
      )}
    </div>
  );
}
