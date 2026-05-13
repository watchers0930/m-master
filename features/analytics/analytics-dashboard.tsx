"use client";

import { useEffect, useState } from "react";

import type { Ga4OverviewResponse } from "@/lib/ga4";

const RANGE_OPTIONS = [
  { value: 7, label: "7일" },
  { value: 30, label: "30일" },
  { value: 90, label: "90일" },
];

type ApiOk<T> = {
  ok: true;
  data: T;
};

type ApiError = {
  ok: false;
  error: {
    message: string;
  };
};

type ApiResponse<T> = ApiOk<T> | ApiError;

function StatCard(props: { label: string; value: string; subLabel: string }) {
  return (
    <article className="analytics-dashboard-card">
      <p>{props.label}</p>
      <strong>{props.value}</strong>
      <span>{props.subLabel}</span>
    </article>
  );
}

function RankingCard(props: { title: string; rows: Array<{ label: string; count: number }> }) {
  return (
    <section className="analytics-ranking-card">
      <div className="analytics-ranking-head">
        <h3>{props.title}</h3>
      </div>
      <div className="analytics-ranking-list">
        {props.rows.length === 0 ? <p className="analytics-empty-copy">데이터가 없습니다.</p> : null}
        {props.rows.map((row, index) => (
          <div className="analytics-ranking-row" key={`${props.title}-${row.label}-${index}`}>
            <span>{index + 1}. {row.label}</span>
            <strong>{row.count.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnalyticsDashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Ga4OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }

      try {
        const response = await fetch(`/api/analytics/overview?days=${days}`, { cache: "no-store" });
        const payload = (await response.json()) as ApiResponse<Ga4OverviewResponse>;

        if (!payload.ok) {
          throw new Error(payload.error.message);
        }

        if (!cancelled) {
          setData(payload.data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setData(null);
          setError(loadError instanceof Error ? loadError.message : "GA4 통계 조회에 실패했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [days, refreshing]);

  const maxSessions = Math.max(...(data?.trend.map((item) => item.sessions) ?? [1]), 1);

  return (
    <section className="analytics-section analytics-dashboard-shell">
      <div className="analytics-toolbar-card">
        <div>
          <h2>GA4 방문자 통계</h2>
          <p>Vestra에서 쓰던 OAuth 기반 GA4 조회 구조를 그대로 적용했습니다.</p>
          {data?.propertyId ? <span>GA4 Property ID: {data.propertyId}</span> : null}
        </div>
        <div className="analytics-toolbar-actions">
          {RANGE_OPTIONS.map((option) => (
            <button
              className={days === option.value ? "analytics-filter-button active" : "analytics-filter-button"}
              key={option.value}
              onClick={() => setDays(option.value)}
              type="button"
            >
              최근 {option.label}
            </button>
          ))}
          <button
            className="analytics-filter-button"
            onClick={() => setRefreshing(true)}
            type="button"
          >
            새로고침
          </button>
        </div>
      </div>

      {loading ? <p className="analytics-loading-copy">GA4 통계를 불러오는 중입니다.</p> : null}
      {error ? <p className="analytics-error-copy">{error}</p> : null}

      {!loading && !error && data ? (
        <>
          <div className="analytics-dashboard-grid">
            <StatCard
              label="총 사용자"
              subLabel={`신규 ${data.overview.newUsers.toLocaleString()}`}
              value={data.overview.totalUsers.toLocaleString()}
            />
            <StatCard
              label="총 세션"
              subLabel={`참여 세션 ${data.overview.engagedSessions.toLocaleString()}`}
              value={data.overview.sessions.toLocaleString()}
            />
            <StatCard
              label="총 페이지뷰"
              subLabel={`세션당 ${data.overview.pagesPerSession}`}
              value={data.overview.views.toLocaleString()}
            />
            <StatCard
              label="평균 세션 시간"
              subLabel={`참여율 ${data.overview.engagementRate}%`}
              value={`${data.overview.avgSessionDurationSec}초`}
            />
            <StatCard
              label="이탈률"
              subLabel={`최근 ${data.rangeDays}일`}
              value={`${data.overview.bounceRate}%`}
            />
          </div>

          <div className="analytics-report-card">
            <div className="analytics-detail-head">
              <p className="analytics-kicker">Trend</p>
              <h2>일자별 세션 추이</h2>
            </div>
            <div className="analytics-report-trend">
              {data.trend.map((item) => {
                const height = Math.max(14, Math.round((item.sessions / maxSessions) * 120));

                return (
                  <div className="analytics-trend-bar" key={item.date}>
                    <span className="analytics-trend-value">{item.sessions}</span>
                    <div className="analytics-trend-column" style={{ height }} />
                    <span className="analytics-trend-label">{item.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="analytics-report-card">
            <div className="analytics-detail-head">
              <p className="analytics-kicker">Pages</p>
              <h2>상위 페이지</h2>
            </div>
            <div className="analytics-report-table-wrap">
              <table className="analytics-report-table">
                <thead>
                  <tr>
                    <th>경로</th>
                    <th>제목</th>
                    <th>페이지뷰</th>
                    <th>사용자</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPages.map((page, index) => (
                    <tr key={`${page.path}-${index}`}>
                      <td>{page.path}</td>
                      <td>{page.title}</td>
                      <td>{page.views.toLocaleString()}</td>
                      <td>{page.users.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="analytics-ranking-grid">
            <RankingCard title="상위 유입 채널" rows={data.topChannels} />
            <RankingCard title="상위 지역" rows={data.topRegions} />
            <RankingCard title="상위 도시" rows={data.topCities} />
            <RankingCard title="기기 유형" rows={data.deviceBreakdown} />
            <RankingCard title="브라우저" rows={data.browserBreakdown} />
          </div>

          <div className="analytics-report-card">
            <div className="analytics-detail-head">
              <p className="analytics-kicker">Notes</p>
              <h2>연결 메모</h2>
            </div>
            <div className="analytics-note-list">
              {data.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
