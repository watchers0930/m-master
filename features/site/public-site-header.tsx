type PublicSiteHeaderProps = {
  active: "content" | "analytics";
};

export function PublicSiteHeader({ active }: PublicSiteHeaderProps) {
  return (
    <header className="public-site-header">
      <a className="public-site-brand" href="/">
        <span className="public-site-brand-mark">m</span>
        <span className="public-site-brand-copy">
          <strong>m-master</strong>
          <span>Context-Aware Marketing Platform</span>
        </span>
      </a>

      <nav aria-label="주요 메뉴" className="public-site-nav">
        <a
          className={active === "content" ? "public-site-nav-link active" : "public-site-nav-link"}
          href="/studio"
        >
          콘텐츠 생성
        </a>
        <a
          className={active === "analytics" ? "public-site-nav-link active" : "public-site-nav-link"}
          href="/analytics"
        >
          방문자 분석
          <span>GA4</span>
        </a>
      </nav>
    </header>
  );
}
