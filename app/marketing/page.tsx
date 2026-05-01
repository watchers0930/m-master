import type { Metadata } from "next";
import Link from "next/link";

import styles from "./page.module.css";

const principles = [
  {
    title: "Context First",
    body: "작업 폴더와 도메인에서 브랜드 맥락을 먼저 읽고, 생성보다 앞단의 이해 품질을 끌어올립니다.",
  },
  {
    title: "Human Approval",
    body: "AI 초안을 바로 확정하지 않고 승인 가능한 프로필 단계로 분리해 오정보 리스크를 줄입니다.",
  },
  {
    title: "One to Many",
    body: "블로그 원문 1건을 기준으로 인스타그램과 페이스북까지 연결된 운영 흐름을 만듭니다.",
  },
];

const workflow = [
  "프로젝트 생성: 폴더와 도메인을 연결해 최소 입력으로 시작",
  "컨텍스트 승인: AI가 추출한 브랜드 프로필을 사용자가 보정",
  "주제 선택: 추천 토픽 중 우선순위를 고정",
  "콘텐츠 편집: 블로그와 SNS 파생 초안을 한 화면에서 수정",
  "검수 및 내보내기: 채널별 품질을 확인하고 발행 준비",
];

const audiences = [
  "1인 마케터: 자료는 많지만 매번 새로 써야 하는 팀",
  "창업팀 대표: 전담 마케팅 조직 없이 제품 문서를 활용해야 하는 팀",
  "에이전시: 고객사별 브랜드 컨텍스트를 빠르게 세팅해야 하는 운영 조직",
];

const proofPoints = [
  { label: "Start Input", value: "Folder + Domain" },
  { label: "Core Output", value: "Brand Profile" },
  { label: "Publishing Model", value: "1 Source -> 3 Channels" },
];

export const metadata: Metadata = {
  title: "m-master Marketing",
  description: "Context-aware marketing platform landing page",
};

export default function MarketingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>m-master</p>
          <h1>Context-aware marketing platform for teams that already have the source material.</h1>
          <p className={styles.lead}>
            문서와 도메인을 읽고 브랜드 컨텍스트를 구조화한 뒤, 블로그 원문부터 인스타그램과 페이스북 파생
            콘텐츠까지 이어지는 운영 흐름을 하나의 제품 안에 담았습니다.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/">
              Dashboard 보기
            </Link>
            <a className={styles.secondaryAction} href="#workflow">
              워크플로우 확인
            </a>
          </div>
        </div>

        <div className={styles.heroPanel}>
          <div className={styles.panelHeader}>
            <span>Marketing OS Preview</span>
            <span>Live Product Story</span>
          </div>
          <div className={styles.panelGrid}>
            {proofPoints.map((item) => (
              <article className={styles.metricCard} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
          <div className={styles.storyCard}>
            <p className={styles.storyLabel}>Why it matters</p>
            <p>
              콘텐츠를 잘 쓰는 모델보다 중요한 것은 브랜드를 얼마나 정확히 이해하느냐입니다. `m-master`는 그
              이해를 승인 가능한 데이터 구조로 고정한 뒤 채널별 결과물에 재사용합니다.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Principles</p>
          <h2>생성 이전의 이해 품질을 마케팅 시스템의 중심에 둡니다.</h2>
        </div>
        <div className={styles.cardGrid}>
          {principles.map((item) => (
            <article className={styles.card} key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} id="workflow">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Workflow</p>
          <h2>입력, 승인, 생성, 검수를 한 흐름으로 묶은 5단계 운영 구조입니다.</h2>
        </div>
        <div className={styles.workflow}>
          {workflow.map((item, index) => (
            <article className={styles.workflowItem} key={item}>
              <div className={styles.stepNo}>{`${index + 1}`.padStart(2, "0")}</div>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.split}>
          <div>
            <p className={styles.eyebrow}>Audience</p>
            <h2>누가 바로 써야 하는지 명확한 제품입니다.</h2>
            <div className={styles.stack}>
              {audiences.map((item) => (
                <article className={styles.listCard} key={item}>
                  {item}
                </article>
              ))}
            </div>
          </div>
          <div className={styles.highlight}>
            <p className={styles.eyebrow}>Positioning</p>
            <h2>“콘텐츠 생성기”가 아니라 “브랜드 컨텍스트 운영 시스템”입니다.</h2>
            <p>
              경쟁력은 글을 길게 쓰는 능력 자체가 아니라, 사용자 자료를 읽고 브랜드 기준을 먼저 세운 뒤 여러
              채널 결과물에 일관되게 반영하는 구조에 있습니다.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
