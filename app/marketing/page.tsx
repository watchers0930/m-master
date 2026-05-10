import type { Metadata } from "next";

const pillars = [
  {
    title: "Context First",
    body: "폴더와 도메인을 읽어 브랜드 맥락을 먼저 구조화합니다. 설명을 잘하는 사람이 아니라 자료를 많이 가진 팀이 유리해집니다.",
  },
  {
    title: "One Source, Many Channels",
    body: "블로그 원문 하나를 기준으로 인스타그램, 페이스북, 발행용 HTML까지 한 흐름에서 파생합니다.",
  },
  {
    title: "Approval Built In",
    body: "자동 추출 결과를 사람이 승인한 뒤 고정해 이후 생성물의 톤, CTA, 금지 표현을 일관되게 유지합니다.",
  },
];

const workflow = [
  "프로젝트를 만들고 폴더 경로와 도메인을 등록합니다.",
  "AI가 문서와 페이지를 읽어 브랜드 요약, 타깃, CTA를 초안으로 만듭니다.",
  "담당자가 필요한 부분만 수정하고 브랜드 프로필을 승인합니다.",
  "주제를 고르면 블로그, 인스타그램, 페이스북 초안이 동시에 생성됩니다.",
  "검수 후 복사, HTML 내보내기, 채널별 발행 준비까지 이어집니다.",
];

const outputs = [
  "브랜드 한 줄 정의",
  "핵심 타깃 세그먼트",
  "톤앤매너와 금지 표현",
  "채널별 CTA 구조",
  "블로그 초안과 SEO 체크",
  "SNS 파생 카피와 이미지 가이드",
];

export const metadata: Metadata = {
  title: "Marketing | m-master",
  description: "문서와 도메인을 읽어 브랜드 컨텍스트를 만들고, 블로그에서 SNS까지 한 번에 전개하는 컨텍스트 기반 마케팅 플랫폼",
};

export default function MarketingPage() {
  return (
    <main className="mk-page">
      <section className="mk-hero">
        <div className="mk-hero-copy">
          <p className="mk-eyebrow">Context-Aware Marketing Platform</p>
          <h1>설명보다 맥락이 먼저인 마케팅 운영 화면</h1>
          <p className="mk-lede">
            흩어진 소개서, 제안서, 웹사이트, 기존 게시물을 읽어 브랜드 컨텍스트를 자동으로 만들고,
            그 위에서 블로그와 SNS 콘텐츠를 일관되게 전개합니다.
          </p>
          <div className="mk-hero-actions">
            <a className="mk-button mk-button-primary" href="/">
              파이프라인 열기
            </a>
            <a className="mk-button mk-button-secondary" href="/marketing">
              공개 소개 페이지
            </a>
          </div>
          <div className="mk-proof">
            <div>
              <strong>Less Input</strong>
              <span>폴더와 도메인만으로 시작</span>
            </div>
            <div>
              <strong>More Context</strong>
              <span>문서 기반 브랜드 프로필 구축</span>
            </div>
            <div>
              <strong>One to Many</strong>
              <span>블로그에서 3채널 운영으로 확장</span>
            </div>
          </div>
        </div>
        <div className="mk-hero-panel">
          <div className="mk-panel-shell">
            <div className="mk-panel-top">
              <span className="mk-dot" />
              <span className="mk-dot" />
              <span className="mk-dot" />
            </div>
            <div className="mk-panel-body">
              <div className="mk-panel-card">
                <p className="mk-panel-label">Brand Snapshot</p>
                <h2>Vestra</h2>
                <p>B2B 팀이 분산된 자료를 정리하지 않고도 마케팅 엔진을 바로 가동할 수 있게 돕는 운영 플랫폼</p>
              </div>
              <div className="mk-panel-grid">
                <div className="mk-panel-metric">
                  <span>Audience</span>
                  <strong>운영 리드</strong>
                </div>
                <div className="mk-panel-metric">
                  <span>CTA</span>
                  <strong>도입 상담 예약</strong>
                </div>
                <div className="mk-panel-metric">
                  <span>Tone</span>
                  <strong>명료함, 실무 중심</strong>
                </div>
                <div className="mk-panel-metric">
                  <span>Channels</span>
                  <strong>Blog / IG / FB</strong>
                </div>
              </div>
              <div className="mk-panel-stream">
                <div>소스 등록</div>
                <div>브랜드 승인</div>
                <div>콘텐츠 생성</div>
                <div>검수 및 발행</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-head">
          <p className="mk-eyebrow">Why It Wins</p>
          <h2>브랜드를 잘 설명하는 사람보다, 자료를 잘 쌓아둔 팀이 강해집니다.</h2>
        </div>
        <div className="mk-card-grid">
          {pillars.map((item) => (
            <article className="mk-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-section mk-band">
        <div className="mk-section-head">
          <p className="mk-eyebrow">Workflow</p>
          <h2>입력형 툴이 아니라 승인 가능한 운영 흐름으로 설계했습니다.</h2>
        </div>
        <div className="mk-steps">
          {workflow.map((step, index) => (
            <div className="mk-step" key={step}>
              <span className="mk-step-no">{String(index + 1).padStart(2, "0")}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-section mk-output-section">
        <div className="mk-section-head">
          <p className="mk-eyebrow">Outputs</p>
          <h2>생성 결과가 아니라 운영에 필요한 구조를 먼저 만듭니다.</h2>
        </div>
        <div className="mk-output-shell">
          <div className="mk-output-copy">
            <p>
              컨텍스트 분석의 목적은 단순 요약이 아닙니다. 이후 모든 콘텐츠 생성, 리뷰, 발행에서
              반복 사용할 수 있는 승인된 브랜드 프로필을 만드는 데 있습니다.
            </p>
            <a className="mk-inline-link" href="/">
              실제 작업 화면으로 이동
            </a>
          </div>
          <div className="mk-output-list">
            {outputs.map((item) => (
              <div className="mk-output-item" key={item}>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-closing">
        <div className="mk-closing-card">
          <p className="mk-eyebrow">For Lean Teams</p>
          <h2>매번 처음부터 카피를 쓰는 팀을, 반복 가능한 브랜드 운영 팀으로 바꿉니다.</h2>
          <p>
            1인 마케터, 창업팀, 다수 고객사를 다루는 에이전시가 가장 빠르게 효율을 얻도록 설계했습니다.
          </p>
          <a className="mk-button mk-button-primary" href="/">
            m-master 실행
          </a>
        </div>
      </section>
    </main>
  );
}
