type AppHeaderProps = {
  active: "content" | "analytics";
  title?: string;
};

export function AppHeader({ active, title = "콘텐츠 파이프라인" }: AppHeaderProps) {
  return (
    <header className="pipeline-header">
      <div className="pipeline-header-left">
        <div className="rule" />
        <span className="eyebrow">M-MASTER</span>
        <h1 className="brand-title">{title}</h1>
        <nav aria-label="콘텐츠 메뉴" className="pipeline-header-nav">
          <a className={active === "content" ? "pipeline-header-link active" : "pipeline-header-link"} href="/">
            콘텐츠생성
          </a>
          <span className="pipeline-header-divider">|</span>
          <a className={active === "analytics" ? "pipeline-header-link active" : "pipeline-header-link"} href="/analytics">
            방문자 분석
          </a>
        </nav>
      </div>
    </header>
  );
}
