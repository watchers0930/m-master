"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AppHeaderProps = {
  active: "content" | "analytics" | "operations" | "settings";
  title?: string;
};

export function AppHeader({ active, title = "콘텐츠 스튜디오" }: AppHeaderProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextProjectId = new URLSearchParams(window.location.search).get("projectId");
    setProjectId(nextProjectId);
  }, []);

  const withProjectId = (path: string) => (projectId ? `${path}?projectId=${projectId}` : path);

  async function handleLogout() {
    if (!projectId || logoutBusy) {
      router.replace("/");
      return;
    }

    setLogoutBusy(true);

    try {
      await fetch(`/api/projects/${projectId}/operators/session`, {
        method: "DELETE",
      });
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <header className="pipeline-header">
      <div className="pipeline-header-left">
        <div className="rule" />
        <span className="eyebrow">M-MASTER</span>
        <h1 className="brand-title">{title}</h1>
        <nav aria-label="콘텐츠 메뉴" className="pipeline-header-nav">
          <a className="pipeline-header-link" href="/">
            홈
          </a>
          <span className="pipeline-header-divider">|</span>
          <a className={active === "content" ? "pipeline-header-link active" : "pipeline-header-link"} href={withProjectId("/studio")}>
            콘텐츠생성
          </a>
          <span className="pipeline-header-divider">|</span>
          <a className={active === "operations" ? "pipeline-header-link active" : "pipeline-header-link"} href={withProjectId("/studio/operations")}>
            운영보드
          </a>
          <span className="pipeline-header-divider">|</span>
          <a className={active === "settings" ? "pipeline-header-link active" : "pipeline-header-link"} href={withProjectId("/studio/settings")}>
            설정
          </a>
          <span className="pipeline-header-divider">|</span>
          <a className={active === "analytics" ? "pipeline-header-link active" : "pipeline-header-link"} href={withProjectId("/studio/analytics")}>
            방문자 분석
          </a>
        </nav>
      </div>
      <div className="pipeline-header-right">
        <button className="button ghost" type="button" onClick={() => void handleLogout()} disabled={logoutBusy}>
          {logoutBusy ? "로그아웃 중..." : "로그아웃"}
        </button>
      </div>
    </header>
  );
}
