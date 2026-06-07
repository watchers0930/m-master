'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listAbTests } from '@/lib/api/ab-test';
import { PlanGate } from '@/components/PlanGate';
import AbTestCard from './components/AbTestCard';

export default function AbTestListPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['ab-test', 'list', { limit: 50 }],
    queryFn: async () => {
      const res = await listAbTests({ limit: 50 });
      if (res.error) throw new Error(res.error.message ?? '목록을 불러오지 못했습니다');
      return res.data?.data ?? [];
    },
  });

  const items = data ?? [];
  const loading = isPending;
  const errorMsg = error ? error.message : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* 헤더 */}
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>A/B 테스트</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
          진행 중·완료된 두 변형 비교 결과를 모아 봅니다
        </p>
      </div>

      <PlanGate feature="abTest">

      {/* 본문 */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '56px 0' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 11-6.219-8.56"/>
          </svg>
        </div>
      ) : errorMsg ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p style={{ color: '#dc2626', fontSize: 12.5 }}>{errorMsg}</p>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={() => refetch()}
          >
            다시 시도
          </button>
        </div>
      ) : items.length === 0 ? (
        /* 빈 상태 — 첫 진입 가이드 버튼 유지 */
        <div style={{ textAlign: 'center', padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--n200)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9 3h6M9 3v8L5 21h14L15 11V3"/>
          </svg>
          <p style={{ fontSize: 13, color: 'var(--sub)' }}>아직 A/B 테스트가 없습니다</p>
          <p style={{ fontSize: 11.5, color: 'var(--sub)' }}>
            콘텐츠 생성 또는 콘텐츠 관리에서 “A/B 테스트 시작” 버튼으로 시작합니다.
          </p>
          <Link href="/content/create" className="btn btn-primary">
            콘텐츠 만들러 가기
          </Link>
        </div>
      ) : (
        /* 카드 그리드 */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 14,
          }}
        >
          {items.map((test) => (
            <AbTestCard key={test.id} test={test} />
          ))}
        </div>
      )}
      </PlanGate>
    </div>
  );
}
