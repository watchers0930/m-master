"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/features/site/app-header";
import type { ProjectListItem } from "@/features/pipeline/types";

type ProjectListResponse = {
  ok?: boolean;
  data?: {
    projects?: ProjectListItem[];
  };
  error?: {
    message?: string;
  };
};

type SessionResponse = {
  ok?: boolean;
  data?: {
    operator?: {
      id: string;
      name: string;
      role: string;
    } | null;
  };
  error?: {
    message?: string;
  };
};

type OperatorsResponse = {
  ok?: boolean;
  data?: {
    bootstrapRequired?: boolean;
  };
  error?: {
    message?: string;
  };
};

export function RootLoginShell() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [operatorName, setOperatorName] = useState("admin");
  const [operatorKey, setOperatorKey] = useState("1111");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as ProjectListResponse | null;

        if (!payload?.ok) {
          throw new Error(payload?.error?.message || "프로젝트 목록을 불러오지 못했습니다.");
        }

        const nextProjects = payload.data?.projects ?? [];
        if (cancelled) {
          return;
        }

        setProjects(nextProjects);
        setSelectedProjectId(nextProjects[0]?.id ?? "");
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "프로젝트 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProjectId) {
      setError("로그인할 프로젝트를 먼저 선택하세요.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const requestSession = async () => {
        const response = await fetch(`/api/projects/${selectedProjectId}/operators/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: operatorName,
            accessKey: operatorKey,
          }),
        });

        return (await response.json().catch(() => null)) as SessionResponse | null;
      };

      let payload = await requestSession();

      if (!payload?.ok && payload?.error?.message === "운영자 계정을 찾지 못했습니다.") {
        const operatorsResponse = await fetch(`/api/projects/${selectedProjectId}/operators`, { cache: "no-store" });
        const operatorsPayload = (await operatorsResponse.json().catch(() => null)) as OperatorsResponse | null;

        if (operatorsPayload?.ok && operatorsPayload.data?.bootstrapRequired) {
          const bootstrapResponse = await fetch(`/api/projects/${selectedProjectId}/operators`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: operatorName,
              accessKey: operatorKey,
              role: "owner",
              bootstrapSecret: operatorKey,
            }),
          });
          const bootstrapPayload = (await bootstrapResponse.json().catch(() => null)) as SessionResponse | null;

          if (!bootstrapPayload?.ok) {
            throw new Error(bootstrapPayload?.error?.message || "첫 운영자 계정을 생성하지 못했습니다.");
          }

          payload = await requestSession();
        }
      }

      if (!payload?.ok || !payload.data?.operator) {
        throw new Error(payload?.error?.message || "로그인에 실패했습니다.");
      }

      router.push(`/studio/operations?projectId=${selectedProjectId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="root-login-page">
      <AppHeader active="content" title="운영자 로그인" />
      <section className="root-login-shell">
        <div className="root-login-panel">
          <div className="root-login-copy">
            <span className="root-login-kicker">M-MASTER</span>
            <h1>
              <span>콘텐츠 기획부터</span>
              <span className="root-login-title-nowrap">운영까지 바로 연결되는</span>
              <span>마케팅 워크스테이션</span>
              <span>입니다</span>
            </h1>
            <p>프로젝트별 로그인 후 월간 계획, 블로그 생성, 운영 보드를 한 화면 흐름으로 이어서 사용할 수 있습니다.</p>
          </div>

          <form className="root-login-form" onSubmit={handleSubmit}>
            <label className="root-login-field">
              <span>프로젝트</span>
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={loading || submitting}>
                {projects.length === 0 ? <option value="">등록된 프로젝트 없음</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="root-login-project-card">
              <strong>{selectedProject?.name || "프로젝트를 선택하세요."}</strong>
              <span>{selectedProject?.domain || "도메인이 아직 없습니다."}</span>
            </div>

            <div className="root-login-field-grid">
              <label className="root-login-field">
                <span>운영자 이름</span>
                <input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="admin" disabled={submitting} />
              </label>
              <label className="root-login-field">
                <span>접근 키</span>
                <input
                  type="password"
                  value={operatorKey}
                  onChange={(event) => setOperatorKey(event.target.value)}
                  placeholder="1111"
                  disabled={submitting}
                />
              </label>
            </div>

            <p className="root-login-hint">기본 로컬 진입값은 `admin / 1111`입니다. owner가 없으면 첫 로그인 시 자동으로 owner를 등록합니다.</p>

            {error ? <p className="root-login-error">{error}</p> : null}

            <div className="root-login-actions">
              <button type="submit" className="root-login-submit" disabled={loading || submitting || !selectedProjectId}>
                {submitting ? "로그인 중…" : "운영보드로 로그인"}
              </button>
              <a className="root-login-secondary" href="/studio">
                스튜디오만 열기
              </a>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
