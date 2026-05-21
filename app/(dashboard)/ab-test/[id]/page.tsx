'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAbTest, updateAbTest, deleteAbTest, getAbTestGa4 } from '@/lib/api/ab-test';
import type { AbTestDetail, AbTestGa4Response } from '@/types/api';
import type { AbTest } from '@/types/db';
import AbTestStatusBadge from '../components/AbTestStatusBadge';
import UrlInputForm from './components/UrlInputForm';
import VariantPreviewPane from './components/VariantPreviewPane';
import GA4MetricsChart from './components/GA4MetricsChart';
import WinnerPanel from './components/WinnerPanel';

interface Props {
  params: Promise<{ id: string }>;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분

export default function AbTestDetailPage({ params }: Props) {
  const { id } = use(params);
  const qc = useQueryClient();

  const detailKey = ['ab-test', 'detail', id] as const;
  const { data: detail = null, isPending: loading, error: detailError, refetch: refetchDetail } =
    useQuery<AbTestDetail | null>({
      queryKey: detailKey,
      queryFn: async () => {
        const res = await getAbTest(id);
        if (res.error) throw new Error(res.error.message ?? '테스트를 불러오지 못했습니다');
        return res.data as AbTestDetail;
      },
    });
  const errorMsg = detailError ? detailError.message : null;

  const ga4Status = detail?.status;
  const shouldFetchGa4 = ga4Status === 'running' || (ga4Status === 'completed' && !detail?.ga4_snapshot);
  const {
    data: ga4Live = null,
    isFetching: ga4Loading,
    error: ga4QueryError,
    refetch: refetchGa4,
  } = useQuery<AbTestGa4Response | null>({
    queryKey: ['ab-test', 'ga4', id],
    enabled: shouldFetchGa4,
    refetchInterval: ga4Status === 'running' ? POLL_INTERVAL_MS : false,
    queryFn: async () => {
      const res = await getAbTestGa4(id);
      if (res.error) throw new Error(res.error.message ?? 'GA4 데이터를 불러오지 못했습니다');
      if (res.data?.auto_completed) {
        // 자동 완료 감지 — detail 캐시 무효화
        await refetchDetail();
      }
      return res.data ?? null;
    },
  });
  const ga4Error = ga4QueryError ? ga4QueryError.message : null;
  const ga4 = ga4Live ?? (detail?.ga4_snapshot ? {
    variant_a: detail.ga4_snapshot.variant_a,
    variant_b: detail.ga4_snapshot.variant_b,
    period: detail.ga4_snapshot.period,
  } : null);

  const [actionLoading, setActL] = useState(false);
  const [actionError, setActE]   = useState<string | null>(null);

  const handleTestUpdated = (updated: AbTest) => {
    qc.setQueryData<AbTestDetail | null>(detailKey, (prev) =>
      prev ? { ...prev, ...updated } : prev,
    );
  };

  const loadGa4 = () => { refetchGa4(); };
  const loadDetail = () => { refetchDetail(); };

  const handleAction = async (action: 'complete' | 'cancel') => {
    if (!detail) return;
    setActL(true);
    setActE(null);

    const res = await updateAbTest(id, { action });
    setActL(false);

    if (res.error) {
      setActE(res.error.message ?? '작업에 실패했습니다');
    } else {
      handleTestUpdated(res.data as AbTest);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    if (!confirm('이 A/B 테스트를 삭제하시겠습니까? 변형 콘텐츠는 보존됩니다.')) return;

    setActL(true);
    setActE(null);

    const res = await deleteAbTest(id);
    setActL(false);

    if (res.error) {
      setActE(res.error.message ?? '삭제에 실패했습니다');
    } else {
      window.location.href = '/ab-test';
    }
  };

  // ── 렌더 ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '56px 0' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <p style={{ fontSize: 13, color: '#dc2626' }}>{errorMsg}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={loadDetail}>다시 시도</button>
          <Link href="/ab-test" className="btn btn-ghost">← 목록</Link>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const topicTruncated = detail.topic.length > 30 ? detail.topic.slice(0, 30) + '…' : detail.topic;
  const showChart      = detail.status === 'running' || detail.status === 'completed';
  const showActions    = detail.status !== 'cancelled' && detail.status !== 'completed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1100 }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Link href="/ab-test" style={{ fontSize: 12, color: 'var(--sub)', textDecoration: 'none' }}>
          ← A/B 테스트 목록
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{topicTruncated}</span>
        <AbTestStatusBadge status={detail.status} />
        <span
          style={{
            background: 'var(--blue-50)',
            color: 'var(--blue-500)',
            border: '1px solid var(--blue-200)',
            borderRadius: 20,
            fontSize: 11,
            padding: '3px 10px',
            fontWeight: 600,
          }}
        >
          블로그 한정
        </span>
      </div>

      {/* Row 1: URL 입력 */}
      <UrlInputForm test={detail} onUpdated={handleTestUpdated} />

      {/* Row 2: 변형 미리보기 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <VariantPreviewPane variant="a" content={detail.variant_a} />
        <VariantPreviewPane variant="b" content={detail.variant_b} />
      </div>

      {/* Row 3: GA4 차트 */}
      {showChart && (
        <GA4MetricsChart
          ga4={ga4}
          loading={ga4Loading}
          error={ga4Error}
          winner={detail.winner ?? null}
          onRetry={loadGa4}
        />
      )}

      {/* Row 4: 승자 패널 */}
      <WinnerPanel test={detail} onUpdated={handleTestUpdated} />

      {/* 오류 */}
      {actionError && (
        <p style={{ fontSize: 12, color: '#dc2626' }}>{actionError}</p>
      )}

      {/* 하단 액션 버튼 */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        {detail.status === 'running' && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actionLoading}
            onClick={() => handleAction('complete')}
          >
            완료로 표시
          </button>
        )}
        {showActions && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actionLoading}
            onClick={() => handleAction('cancel')}
          >
            취소
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={actionLoading}
          onClick={handleDelete}
          style={{ marginLeft: 'auto', color: '#dc2626', borderColor: '#fca5a5' }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}
