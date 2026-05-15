import type { Metadata } from "next";
import { PublicSiteHeader } from "@/features/site/public-site-header";

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

const comparisons = [
  {
    label: "일반 AI 카피 툴",
    input: "브랜드 설명을 사람이 길게 입력해야 함",
    output: "채널별 초안은 빠르지만 맥락 품질 편차가 큼",
  },
  {
    label: "대행사 수작업 운영",
    input: "자료 취합과 브리프 정리에 시간이 많이 듦",
    output: "품질은 높지만 반복 비용과 리드타임이 큼",
  },
  {
    label: "m-master",
    input: "폴더와 도메인을 읽고 승인 가능한 브랜드 프로필부터 생성",
    output: "블로그 원문부터 SNS, 발행 준비까지 한 흐름으로 연결",
  },
];

const audiences = [
  {
    name: "1인 마케터",
    pain: "브랜드 자료는 쌓여 있는데 매번 처음부터 카피를 다시 써야 합니다.",
    gain: "승인된 브랜드 프로필을 재사용해 주제 선정부터 발행 준비까지 시간을 줄입니다.",
  },
  {
    name: "창업팀",
    pain: "제품 문서와 소개 자료는 많지만 마케팅 전담 조직이 없습니다.",
    gain: "기존 자료를 바로 읽혀 블로그와 SNS 운영 루틴을 빠르게 세웁니다.",
  },
  {
    name: "에이전시",
    pain: "고객사마다 브리프 형식이 달라 온보딩 품질이 흔들립니다.",
    gain: "폴더 기반 분석과 승인 플로우로 고객사별 컨텍스트 셋업을 표준화합니다.",
  },
];

const deliverables = [
  "승인 가능한 브랜드 요약과 타깃 정의",
  "톤앤매너, CTA, 금지 표현 규칙",
  "주제 추천과 블로그 초안",
  "인스타그램 카드뉴스형 카피",
  "페이스북 링크 포스트형 문안",
  "복사, HTML 내보내기, 발행 준비 데이터",
];

export const metadata: Metadata = {
  title: "Marketing | m-master",
  description:
    "문서와 도메인을 읽어 브랜드 컨텍스트를 만들고, 블로그에서 SNS까지 한 번에 전개하는 컨텍스트 기반 마케팅 플랫폼",
};

export default function MarketingPage() {
  return (
    <main className="mk-page">
      <PublicSiteHeader active="content" />

      <section className="mk-hero">
        <div className="mk-hero-copy">
          <p className="mk-eyebrow">Context-Aware Marketing Platform</p>
          <h1>설명보다 먼저, 브랜드 맥락을 읽는 마케팅 운영</h1>
          <p className="mk-lede">
            흩어진 소개서, 제안서, 웹사이트, 기존 게시물을 읽어 브랜드 컨텍스트를 자동으로 만들고,
            그 위에서 블로그와 SNS 콘텐츠를 일관되게 전개합니다.
          </p>
          <div className="mk-hero-actions">
            <a className="mk-button mk-button-primary" href="/studio">
              스튜디오 열기
            </a>
            <a className="mk-button mk-button-secondary" href="/">
              공개 쇼케이스 보기
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
          <p className="mk-eyebrow">Positioning</p>
          <h2>카피 생성기가 아니라, 브랜드 컨텍스트를 운영 가능한 자산으로 만드는 시스템입니다.</h2>
        </div>
        <div className="mk-compare-grid">
          {comparisons.map((item) => (
            <article className={`mk-compare-card${item.label === "m-master" ? " featured" : ""}`} key={item.label}>
              <p className="mk-compare-label">{item.label}</p>
              <div className="mk-compare-row">
                <span>입력 방식</span>
                <strong>{item.input}</strong>
              </div>
              <div className="mk-compare-row">
                <span>운영 결과</span>
                <strong>{item.output}</strong>
              </div>
            </article>
          ))}
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

      <section className="mk-section">
        <div className="mk-section-head">
          <p className="mk-eyebrow">Best Fit</p>
          <h2>자료는 충분하지만 운영 루틴이 부족한 팀에서 가장 빠르게 효과가 납니다.</h2>
        </div>
        <div className="mk-audience-grid">
          {audiences.map((item) => (
            <article className="mk-audience-card" key={item.name}>
              <p className="mk-audience-name">{item.name}</p>
              <p className="mk-audience-pain">{item.pain}</p>
              <p className="mk-audience-gain">{item.gain}</p>
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

      <section className="mk-section">
        <div className="mk-section-head">
          <p className="mk-eyebrow">Deliverables</p>
          <h2>도입 직후 필요한 건 많지 않습니다. 대신 바로 써먹을 운영 산출물이 남아야 합니다.</h2>
        </div>
        <div className="mk-deliverable-grid">
          {deliverables.map((item, index) => (
            <div className="mk-deliverable-card" key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-section mk-closing">
        <div className="mk-closing-card">
          <p className="mk-eyebrow">For Lean Teams</p>
          <h2>매번 처음부터 카피를 쓰는 팀을, 반복 가능한 브랜드 운영 팀으로 바꿉니다.</h2>
          <p>
            1인 마케터, 창업팀, 다수 고객사를 다루는 에이전시가 가장 빠르게 효율을 얻도록 설계했습니다.
          </p>
          <div className="mk-closing-points">
            <div>폴더 기반 온보딩</div>
            <div>승인 가능한 브랜드 프로필</div>
            <div>블로그·인스타·페이스북 동시 운영</div>
          </div>
          <a className="mk-button mk-button-primary" href="/">
            공개 쇼케이스에서 확인
          </a>
        </div>
      </section>
    </main>
  );
}
