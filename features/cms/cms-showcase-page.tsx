import type { CmsSectionDto } from "@/types/cms";

function getSectionEyebrow(key: string) {
  if (key === "platform-development") {
    return "Platform Development";
  }

  return "Key Achievements";
}

export function CmsShowcasePage({ sections }: { sections: CmsSectionDto[] }) {
  return (
    <main className="showcase-shell">
      <section className="showcase-hero">
        <div className="showcase-hero-copy">
          <p className="showcase-kicker">CMS Managed Showcase</p>
          <h1>플랫폼개발과 주요실적을 관리자에서 직접 운영하는 공개 페이지</h1>
          <p className="showcase-lead">
            운영자는 <code>/cms</code>에서 섹션과 항목을 수정하고, 공개 페이지는 같은 데이터를 그대로 렌더링합니다.
          </p>
          <div className="showcase-actions">
            <a className="showcase-primary-link" href="/cms">
              관리자 열기
            </a>
            <a className="showcase-secondary-link" href="/studio">
              스튜디오 보기
            </a>
          </div>
        </div>
        <div className="showcase-hero-panel">
          <div className="showcase-stat-card">
            <span>관리 섹션</span>
            <strong>{sections.length}</strong>
          </div>
          <div className="showcase-stat-card">
            <span>공개 항목</span>
            <strong>{sections.reduce((count, section) => count + section.items.length, 0)}</strong>
          </div>
        </div>
      </section>

      {sections.map((section) => (
        <section className="showcase-section" key={section.id}>
          <div className="showcase-section-head">
            <p className="showcase-section-kicker">{getSectionEyebrow(section.key)}</p>
            <h2>{section.title}</h2>
            {section.description ? <p>{section.description}</p> : null}
          </div>
          <div className="showcase-grid">
            {section.items.length > 0 ? (
              section.items.map((item) => (
                <article className="showcase-card" key={item.id}>
                  <div className="showcase-card-head">
                    <div>
                      <h3>{item.title}</h3>
                      {item.subtitle ? <p>{item.subtitle}</p> : null}
                    </div>
                    {item.featured ? <span className="showcase-badge">Featured</span> : null}
                  </div>
                  <p className="showcase-summary">{item.summary}</p>
                  <dl className="showcase-meta">
                    {item.clientName ? (
                      <>
                        <dt>고객</dt>
                        <dd>{item.clientName}</dd>
                      </>
                    ) : null}
                    {item.periodLabel ? (
                      <>
                        <dt>기간</dt>
                        <dd>{item.periodLabel}</dd>
                      </>
                    ) : null}
                    <dt>상태</dt>
                    <dd>{item.status}</dd>
                  </dl>
                  {item.tags.length > 0 ? (
                    <div className="showcase-tags">
                      {item.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  {item.body ? <p className="showcase-body">{item.body}</p> : null}
                  {item.linkUrl ? (
                    <a className="showcase-inline-link" href={item.linkUrl} target="_blank" rel="noreferrer">
                      상세 보기
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="showcase-empty-card">
                <p>아직 공개된 항목이 없습니다. 관리자에서 항목을 추가하면 여기에 바로 반영됩니다.</p>
              </div>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
