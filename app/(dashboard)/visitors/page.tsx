'use client';

import { useState, useEffect, useCallback } from 'react';
import { PeriodPicker } from './PeriodPicker';
import { RealtimeBadge } from './RealtimeBadge';
import {
  KpiCard, DailySparkline, TrafficSourcesTable, TopPagesTable,
  ReferralTables, DemographicsBlock, DevicesBlock, EntryExitBlock,
  nfmt, pct100, dur,
} from './components';

type Period = 'today' | 'this_week' | 'this_month' | '7d' | '30d' | '90d' | '365d';
const VALID: Period[] = ['today', 'this_week', 'this_month', '7d', '30d', '90d', '365d'];

const EMPTY_KPI = {
  sessions: 0, sessionsDelta: 0, activeUsers: 0, activeUsersDelta: 0,
  newUsers: 0, newUsersDelta: 0, pageViews: 0, pageViewsDelta: 0,
  bounceRate: 0, bounceRateDelta: 0, avgSessionDuration: 0, avgSessionDurationDelta: 0,
  engagementRate: 0, engagementRateDelta: 0, eventsPerSession: 0,
};

export default function VisitorsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`/api/visitors/data?period=${p}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const handlePeriodChange = (p: string) => {
    if ((VALID as string[]).includes(p)) setPeriod(p as Period);
  };

  const kpi = data?.kpi ?? EMPTY_KPI;
  const traffic = data?.traffic ?? [];
  const daily = data?.daily ?? [];
  const pages = data?.pages ?? [];
  const refs = data?.refs ?? { sources: [], searchTerms: [] };
  const demo = data?.demo ?? { ages: [], genders: [], cities: [], countries: [] };
  const devs = data?.devs ?? { devices: [], browsers: [], os: [] };
  const entry = data?.entry ?? { landings: [], exits: [] };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1400 }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>방문자 분석</h1>
          <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
            GA4에서 수집한 사이트 트래픽 전체
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <PeriodPicker value={period} onChange={handlePeriodChange} />
          <RealtimeBadge />
        </div>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--sub)', fontSize: 13 }}>
          GA4 데이터를 불러오는 중...
        </div>
      )}

      {error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--sub)', fontSize: 12, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
          GA4 데이터를 불러올 수 없습니다: {error}<br />
          GA4 자격증명과 Property ID를 확인해주세요.
        </div>
      )}

      {!loading && !error && (
        <>
          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <KpiCard label="세션" value={nfmt(kpi.sessions)} delta={kpi.sessionsDelta} sub="전기 대비" />
            <KpiCard label="활성 사용자" value={nfmt(kpi.activeUsers)} delta={kpi.activeUsersDelta} sub="전기 대비" />
            <KpiCard label="신규 사용자" value={nfmt(kpi.newUsers)} delta={kpi.newUsersDelta} sub="전기 대비" />
            <KpiCard label="페이지뷰" value={nfmt(kpi.pageViews)} delta={kpi.pageViewsDelta} sub="전기 대비" />
            <KpiCard label="이탈률" value={pct100(kpi.bounceRate)} delta={kpi.bounceRateDelta} lowerBetter sub="전기 대비" />
            <KpiCard label="참여율" value={pct100(kpi.engagementRate)} delta={kpi.engagementRateDelta} sub="전기 대비" />
            <KpiCard label="평균 체류시간" value={dur(kpi.avgSessionDuration)} delta={kpi.avgSessionDurationDelta} sub="전기 대비" />
            <KpiCard label="세션당 이벤트" value={kpi.eventsPerSession.toFixed(1)} sub="이벤트 / 세션" />
          </div>

          {/* 일별 시계열 + 트래픽 소스 */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
            <div className="card">
              <div className="card-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                  <polyline points="3,17 9,11 13,15 21,7"/>
                </svg>
                <span className="card-title">일별 추이</span>
                <span style={{ fontSize: 10, color: 'var(--sub)' }}>페이지뷰</span>
              </div>
              <div style={{ padding: 16 }}><DailySparkline data={daily} /></div>
            </div>
            <div className="card">
              <div className="card-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 010 20M2 12h20"/>
                </svg>
                <span className="card-title">트래픽 소스</span>
              </div>
              <div style={{ padding: '8px 12px 12px' }}><TrafficSourcesTable rows={traffic} /></div>
            </div>
          </div>

          {/* 인기 페이지 */}
          <div className="card">
            <div className="card-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
              </svg>
              <span className="card-title">인기 페이지</span>
              <span style={{ fontSize: 10, color: 'var(--sub)' }}>TOP 20 · 조회수 기준</span>
            </div>
            <div style={{ padding: '8px 12px 12px' }}><TopPagesTable rows={pages} /></div>
          </div>

          {/* 유입 경로 */}
          <div className="card">
            <div className="card-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
              </svg>
              <span className="card-title">유입 경로</span>
            </div>
            <div style={{ padding: 16 }}>
              <ReferralTables sources={refs.sources} searchTerms={refs.searchTerms} />
            </div>
          </div>

          {/* 인구통계 */}
          <div className="card">
            <div className="card-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
              <span className="card-title">인구통계</span>
              <span style={{ fontSize: 10, color: 'var(--sub)' }}>연령 · 성별 · 지역</span>
            </div>
            <div style={{ padding: 16 }}>
              <DemographicsBlock ages={demo.ages} genders={demo.genders} cities={demo.cities} countries={demo.countries} />
            </div>
          </div>

          {/* 디바이스 */}
          <div className="card">
            <div className="card-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <span className="card-title">디바이스 · 브라우저 · OS</span>
            </div>
            <div style={{ padding: 16 }}>
              <DevicesBlock devices={devs.devices} browsers={devs.browsers} os={devs.os} />
            </div>
          </div>

          {/* 랜딩/이탈 */}
          <div className="card">
            <div className="card-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 12l2-2 4 4 8-8 4 4"/>
              </svg>
              <span className="card-title">랜딩 · 이탈</span>
            </div>
            <div style={{ padding: 16 }}>
              <EntryExitBlock landings={entry.landings} exits={entry.exits} />
            </div>
          </div>

          <p style={{ fontSize: 10.5, color: 'var(--sub)', textAlign: 'right' }}>
            캐시: 실시간 30초 · 개요 5분 · 상세 15분 · 클라이언트 5분
          </p>
        </>
      )}
    </div>
  );
}
