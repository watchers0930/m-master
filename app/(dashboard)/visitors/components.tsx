// 방문자 분석 페이지의 표시 전용 작은 컴포넌트들
import type {
  TrafficSource, DailyPoint, TopPage, ReferralSource, SearchTermRow,
  AgeGroup, GenderRow, CityRow, CountryRow, DeviceRow, BrowserRow, OsRow,
  LandingPage, ExitPage,
} from '@/lib/ga4/visitors';

function nfmt(n: number) { return Math.round(n).toLocaleString(); }
function pct(n: number) { return `${n.toFixed(1)}%`; }
function pct100(n: number) { return `${Math.round(n * 1000) / 10}%`; }
function dur(s: number) {
  if (!s) return '0초';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}분 ${r}초` : `${r}초`;
}

function deltaColor(d: number, lowerBetter = false) {
  if (d === 0) return 'var(--sub)';
  const up = d > 0;
  if (lowerBetter) return up ? '#dc2626' : '#16a34a';
  return up ? '#16a34a' : '#dc2626';
}

function deltaText(d: number) {
  const sign = d > 0 ? '▲' : d < 0 ? '▼' : '–';
  return `${sign} ${Math.abs(d).toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI 카드
// ─────────────────────────────────────────────────────────────────────────────
export function KpiCard({
  label, value, delta, lowerBetter, sub,
}: { label: string; value: string; delta?: number; lowerBetter?: boolean; sub?: string }) {
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80 }}>
      <div style={{ fontSize: 11, color: 'var(--sub)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5 }}>
        {typeof delta === 'number' && (
          <span style={{ color: deltaColor(delta, lowerBetter), fontWeight: 600 }}>
            {deltaText(delta)}
          </span>
        )}
        {sub && <span style={{ color: 'var(--sub)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 가로 비율 바 (테이블 안에서 사용)
// ─────────────────────────────────────────────────────────────────────────────
function Bar({ pct, color = 'var(--blue-400)' }: { pct: number; color?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: 'relative', height: 6, background: 'var(--n100)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, width: `${w}%`, background: color, borderRadius: 3 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 일별 시계열 (단순 미니바)
// ─────────────────────────────────────────────────────────────────────────────
export function DailySparkline({ data }: { data: DailyPoint[] }) {
  if (data.length === 0) return <Empty />;
  const max = Math.max(1, ...data.map(d => d.views));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, padding: '0 4px' }}>
        {data.map((d, i) => {
          const h = (d.views / max) * 100;
          return (
            <div
              key={i}
              title={`${d.date} · 페이지뷰 ${nfmt(d.views)} · 세션 ${nfmt(d.sessions)}`}
              style={{
                flex: 1,
                minWidth: 2,
                height: `${Math.max(2, h)}%`,
                background: 'var(--blue-400)',
                borderRadius: '2px 2px 0 0',
                opacity: 0.85,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--sub)', padding: '0 4px' }}>
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 트래픽 소스 표
// ─────────────────────────────────────────────────────────────────────────────
export function TrafficSourcesTable({ rows }: { rows: TrafficSource[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <Th>채널</Th>
          <Th align="right">세션</Th>
          <Th align="right" style={{ width: 70 }}>비중</Th>
          <Th style={{ width: 120 }}>분포</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.channel} style={{ borderBottom: '1px solid var(--border2)' }}>
            <Td>{r.channel}</Td>
            <Td align="right">{nfmt(r.sessions)}</Td>
            <Td align="right">{pct(r.percentage)}</Td>
            <Td><Bar pct={r.percentage} /></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 인기 페이지 표
// ─────────────────────────────────────────────────────────────────────────────
export function TopPagesTable({ rows }: { rows: TopPage[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Th>경로 / 제목</Th>
            <Th align="right">조회</Th>
            <Th align="right">평균 체류</Th>
            <Th align="right">이탈률</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.path} style={{ borderBottom: '1px solid var(--border2)' }}>
              <Td>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 10.5, color: 'var(--sub)' }}>{r.path}</div>
              </Td>
              <Td align="right">{nfmt(r.views)}</Td>
              <Td align="right">{dur(r.avgTimeOnPage)}</Td>
              <Td align="right">{pct100(r.bounceRate)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 유입 소스 표 + 검색어
// ─────────────────────────────────────────────────────────────────────────────
export function ReferralTables({ sources, searchTerms }: { sources: ReferralSource[]; searchTerms: SearchTermRow[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>소스 / 매체</h3>
        {sources.length === 0 ? <Empty /> : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>소스 / 매체</Th>
                <Th align="right">세션</Th>
                <Th align="right" style={{ width: 60 }}>비중</Th>
              </tr>
            </thead>
            <tbody>
              {sources.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <Td>{r.source} / {r.medium}</Td>
                  <Td align="right">{nfmt(r.sessions)}</Td>
                  <Td align="right">{pct(r.percentage)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>사이트 내 검색어</h3>
        {searchTerms.length === 0 ? <Empty hint="검색어 이벤트가 수집되지 않음" /> : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>검색어</Th>
                <Th align="right">세션</Th>
              </tr>
            </thead>
            <tbody>
              {searchTerms.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <Td>{r.term}</Td>
                  <Td align="right">{nfmt(r.sessions)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 인구통계
// ─────────────────────────────────────────────────────────────────────────────
export function DemographicsBlock({
  ages, genders, cities, countries,
}: { ages: AgeGroup[]; genders: GenderRow[]; cities: CityRow[]; countries: CountryRow[] }) {
  const hasData = ages.length + genders.length + cities.length + countries.length > 0;
  if (!hasData) return <Empty hint="Google 신호 데이터 비활성 또는 충분한 표본 부족" />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
      <SubBlock title="연령대">
        {ages.length === 0 ? <Empty /> : <PctList rows={ages.map(a => ({ label: a.bracket, value: a.users, pct: a.percentage }))} />}
      </SubBlock>
      <SubBlock title="성별">
        {genders.length === 0 ? <Empty /> : <PctList rows={genders.map(g => ({ label: g.gender, value: g.users, pct: g.percentage }))} />}
      </SubBlock>
      <SubBlock title="국가">
        {countries.length === 0 ? <Empty /> : <PctList rows={countries.slice(0, 10).map(c => ({ label: c.country, value: c.users, pct: c.percentage }))} />}
      </SubBlock>
      <SubBlock title="도시">
        {cities.length === 0 ? <Empty /> : <PctList rows={cities.slice(0, 10).map(c => ({ label: c.city, value: c.users, pct: c.percentage }))} />}
      </SubBlock>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 디바이스
// ─────────────────────────────────────────────────────────────────────────────
export function DevicesBlock({
  devices, browsers, os,
}: { devices: DeviceRow[]; browsers: BrowserRow[]; os: OsRow[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
      <SubBlock title="디바이스 카테고리">
        {devices.length === 0 ? <Empty /> : <PctList rows={devices.map(d => ({ label: d.device, value: d.sessions, pct: d.percentage }))} />}
      </SubBlock>
      <SubBlock title="브라우저">
        {browsers.length === 0 ? <Empty /> : <PctList rows={browsers.map(b => ({ label: b.browser, value: b.sessions, pct: b.percentage }))} />}
      </SubBlock>
      <SubBlock title="운영체제">
        {os.length === 0 ? <Empty /> : <PctList rows={os.map(o => ({ label: o.os, value: o.sessions, pct: o.percentage }))} />}
      </SubBlock>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 랜딩/이탈
// ─────────────────────────────────────────────────────────────────────────────
export function EntryExitBlock({ landings, exits }: { landings: LandingPage[]; exits: ExitPage[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <SubBlock title="랜딩 페이지">
        {landings.length === 0 ? <Empty /> : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>경로</Th>
                <Th align="right">세션</Th>
                <Th align="right">이탈률</Th>
              </tr>
            </thead>
            <tbody>
              {landings.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <Td>{r.path}</Td>
                  <Td align="right">{nfmt(r.sessions)}</Td>
                  <Td align="right">{pct100(r.bounceRate)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubBlock>
      <SubBlock title="이탈 페이지 (session_end)">
        {exits.length === 0 ? <Empty hint="session_end 이벤트 미수집" /> : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>경로</Th>
                <Th align="right">이탈수</Th>
              </tr>
            </thead>
            <tbody>
              {exits.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <Td>{r.path}</Td>
                  <Td align="right">{nfmt(r.exits)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubBlock>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 공용
// ─────────────────────────────────────────────────────────────────────────────
function SubBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>{title}</h3>
      {children}
    </div>
  );
}

function PctList({ rows }: { rows: { label: string; value: number; pct: number }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
            <span style={{ color: 'var(--text)' }}>{r.label}</span>
            <span style={{ color: 'var(--sub)' }}>{nfmt(r.value)} · {pct(r.pct)}</span>
          </div>
          <Bar pct={r.pct} />
        </div>
      ))}
    </div>
  );
}

function Empty({ hint }: { hint?: string } = {}) {
  return (
    <div style={{ padding: '24px 8px', fontSize: 11, color: 'var(--sub)', textAlign: 'center' }}>
      {hint ?? '데이터 없음'}
    </div>
  );
}

function Th({ children, align = 'left', style }: { children: React.ReactNode; align?: 'left' | 'right'; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: '8px 6px', textAlign: align, fontSize: 11, fontWeight: 600, color: 'var(--sub)', ...style }}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{ padding: '8px 6px', textAlign: align, color: 'var(--text)', verticalAlign: 'top' }}>{children}</td>
  );
}

export { nfmt, pct, pct100, dur };
