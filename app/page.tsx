export default function HomePage() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <div className="marketing-hero-bg" />
        <header className="marketing-nav">
          <div className="marketing-brand">
            <span className="marketing-brand-mark" />
            <div>
              <span className="marketing-brand-eyebrow">M-MASTER</span>
              <strong>Context-Aware Marketing Studio</strong>
            </div>
          </div>
          <nav className="marketing-nav-links" aria-label="주요 이동">
            <a href="#capabilities">기능</a>
            <a href="#workflow">워크플로우</a>
            <a href="#analytics">분석</a>
            <a className="marketing-nav-cta" href="/studio">스튜디오 열기</a>
          </nav>
        </header>

        <div className="marketing-hero-grid">
          <div className="marketing-hero-copy">
            <p className="marketing-kicker">사이트 맥락을 읽고 바로 콘텐츠로 연결합니다</p>
            <h1>브랜드 콘텍스트 승인부터 채널별 초안 생성, 검수, 배포 준비까지 한 화면에서 처리합니다.</h1>
            <p className="marketing-lead">
              M-MASTER는 URL과 소개 자료를 바탕으로 브랜드 요약을 만들고, 블로그·인스타그램·페이스북 초안을
              연결된 흐름으로 생성하는 운영형 마케팅 워크스테이션입니다.
            </p>
            <div className="marketing-hero-actions">
              <a className="marketing-button marketing-button-primary" href="/studio">콘텐츠 스튜디오 시작</a>
              <a className="marketing-button marketing-button-secondary" href="/studio/analytics">방문자 분석 보기</a>
            </div>
            <dl className="marketing-stat-grid">
              <div>
                <dt>1회 입력</dt>
                <dd>3채널 동시 생성</dd>
              </div>
              <div>
                <dt>브랜드 승인</dt>
                <dd>초안 전 선행 검수</dd>
              </div>
              <div>
                <dt>A/B 비교</dt>
                <dd>채택 흐름 내장</dd>
              </div>
            </dl>
          </div>

          <div className="marketing-preview-card">
            <div className="marketing-preview-top">
              <span className="marketing-preview-pill">Live Workflow</span>
              <span className="marketing-preview-meta">Studio / Review / Export</span>
            </div>
            <div className="marketing-preview-body">
              <article>
                <span>1</span>
                <div>
                  <strong>브랜드 콘텍스트 승인</strong>
                  <p>사이트 요약, 타겟, 톤, CTA를 먼저 정리합니다.</p>
                </div>
              </article>
              <article>
                <span>2</span>
                <div>
                  <strong>콘텐츠 일괄 생성</strong>
                  <p>한 주제로 블로그와 SNS 파생안을 동시에 준비합니다.</p>
                </div>
              </article>
              <article>
                <span>3</span>
                <div>
                  <strong>검수와 배포 준비</strong>
                  <p>SEO, CTA 명확도, 채널 적합도를 확인한 뒤 내보냅니다.</p>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="capabilities">
        <div className="marketing-section-heading">
          <p>Core Capabilities</p>
          <h2>운영자가 실제로 막히는 지점을 줄이는 구조로 설계했습니다.</h2>
        </div>
        <div className="marketing-card-grid">
          <article className="marketing-feature-card">
            <span>Context Draft</span>
            <h3>브랜드 콘텍스트를 먼저 확정</h3>
            <p>생성 전에 브랜드 요약과 금지 표현을 승인해, 채널별 초안이 처음부터 같은 기준을 따르도록 합니다.</p>
          </article>
          <article className="marketing-feature-card">
            <span>Connected Drafts</span>
            <h3>블로그와 SNS가 분리되지 않습니다</h3>
            <p>블로그 원문을 기준으로 인스타그램과 페이스북 파생 초안을 함께 비교하고 바로 수정할 수 있습니다.</p>
          </article>
          <article className="marketing-feature-card">
            <span>Review Layer</span>
            <h3>점검 기준이 화면 안에 있습니다</h3>
            <p>SEO 점수, CTA 명확도, 채널 적합도, 브랜드 일치도를 작업 흐름 안에서 바로 확인합니다.</p>
          </article>
          <article className="marketing-feature-card">
            <span>Export Ready</span>
            <h3>배포 직전 형태까지 정리</h3>
            <p>채널별 결과와 JSON, 블로그 게시용 결과를 바로 확인하고 복사 가능한 포맷으로 준비합니다.</p>
          </article>
        </div>
      </section>

      <section className="marketing-section marketing-section-alt" id="workflow">
        <div className="marketing-section-heading">
          <p>Workflow</p>
          <h2>사이트 입력부터 발행 준비까지 끊기지 않는 순서로 이어집니다.</h2>
        </div>
        <div className="marketing-timeline">
          <article>
            <strong>01. 프로젝트 등록</strong>
            <p>도메인과 작업 폴더를 연결하고 기반 자료를 불러옵니다.</p>
          </article>
          <article>
            <strong>02. 콘텍스트 승인</strong>
            <p>AI가 읽은 브랜드 요약을 점검하고 타겟, 톤, CTA를 수정합니다.</p>
          </article>
          <article>
            <strong>03. 토픽 생성</strong>
            <p>주제를 입력하면 3개 채널 초안을 같은 맥락으로 생성합니다.</p>
          </article>
          <article>
            <strong>04. 검수와 내보내기</strong>
            <p>채널별 편집, A/B 채택, 게시 전 결과 복사까지 한 화면에서 마칩니다.</p>
          </article>
        </div>
      </section>

      <section className="marketing-section" id="analytics">
        <div className="marketing-analytics-callout">
          <div>
            <p>Analytics</p>
            <h2>생성만 하지 않고 유입 결과도 같은 제품 안에서 확인합니다.</h2>
            <span>세션, 순 방문자, 인기 페이지, 유입 경로, GA4 연결 상태를 `/studio/analytics`에서 확인할 수 있습니다.</span>
          </div>
          <a className="marketing-button marketing-button-primary" href="/studio/analytics">분석 화면 열기</a>
        </div>
      </section>
    </main>
  );
}
