"use client";

import { useEffect, useState } from "react";

import { ContentStudio } from "@/features/dashboard/content-studio";
import { ProjectIntakeForm } from "@/features/dashboard/project-intake-form";
import { ProjectOverview } from "@/features/dashboard/project-overview";
import type {
  ChannelKey,
  EditableBrandProfileField,
  ProjectDetail,
  ProjectListItem,
  ProjectPreview,
  SourceFileDraft,
  StudioAsset,
  StudioDetail,
} from "@/features/dashboard/types";

type ApiOk<T> = {
  ok: true;
  data: T;
};

type ApiError = {
  ok: false;
  error: {
    message: string;
  };
};

type ApiResponse<T> = ApiOk<T> | ApiError;

const SUPPORTED_EXTENSIONS = new Set(["md", "txt", "html", "htm", "json"]);

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

async function collectFolderFiles(directoryHandle: FileSystemDirectoryHandle) {
  const files: SourceFileDraft[] = [];

  async function walk(handle: FileSystemDirectoryHandle, segments: string[] = [], depth = 0) {
    const iterableHandle = handle as FileSystemDirectoryHandle & {
      values: () => AsyncIterable<FileSystemHandle>;
    };

    if (depth > 2 || files.length >= 8) {
      return;
    }

    for await (const entry of iterableHandle.values()) {
      if (files.length >= 8) {
        return;
      }

      if (entry.kind === "directory") {
        await walk(entry as FileSystemDirectoryHandle, [...segments, entry.name], depth + 1);
        continue;
      }

      const file = await (entry as FileSystemFileHandle).getFile();
      const extension = file.name.split(".").pop()?.toLowerCase();

      if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      const excerpt = await file.text();

      files.push({
        name: file.name,
        relativePath: [...segments, file.name].join("/"),
        mimeType: file.type || undefined,
        extension,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString(),
        excerpt: excerpt.replace(/\s+/g, " ").slice(0, 4000),
      });
    }
  }

  await walk(directoryHandle);
  return files;
}

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function createEmptyAsset(channel: ChannelKey): StudioAsset {
  return {
    channel,
    title: "",
    body: "",
    cta: "",
  };
}

export function DashboardShell() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [studio, setStudio] = useState<StudioDetail | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("blog");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [workingPath, setWorkingPath] = useState("");
  const [files, setFiles] = useState<SourceFileDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const folderSupported = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

  async function loadProjects() {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const payload = await parseJson<ApiResponse<{ projects: ProjectListItem[] }>>(response);

    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    setProjects(payload.data.projects);
    if (payload.data.projects[0] && !activeProject) {
      await loadProject(payload.data.projects[0].id);
    }
  }

  async function loadProject(projectId: string) {
    const [detailResponse, studioResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
      fetch(`/api/projects/${projectId}/studio`, { cache: "no-store" }),
    ]);

    const detailPayload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(detailResponse);
    const studioPayload = await parseJson<ApiResponse<{ studio: StudioDetail }>>(studioResponse);

    if (!detailPayload.ok) {
      throw new Error(detailPayload.error.message);
    }

    if (!studioPayload.ok) {
      throw new Error(studioPayload.error.message);
    }

    const nextProject = detailPayload.data.project;
    const nextStudio = studioPayload.data.studio;
    const matchedTopic = nextProject.topics.find((topic) => topic.title === nextStudio.draft.topic) || nextProject.topics[0];

    setActiveProject(nextProject);
    setStudio(nextStudio);
    setSelectedTopicId(matchedTopic?.id ?? null);
  }

  async function requestPreview() {
    setError(null);

    if (!name.trim()) {
      setError("프로젝트 이름은 필수입니다.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/projects/context-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          domain,
          workingPath,
          sourceFiles: files,
        }),
      });

      const payload = await parseJson<
        ApiResponse<{
          preview: {
            contextDraft: ProjectPreview["brandProfile"];
            topics: ProjectPreview["topics"];
            sourceAnalysis: ProjectPreview["sourceAnalysis"];
          };
        }>
      >(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setPreview({
        brandProfile: payload.data.preview.contextDraft,
        topics: payload.data.preview.topics,
        sourceAnalysis: payload.data.preview.sourceAnalysis,
      });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "미리보기를 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "프로젝트 목록을 불러오지 못했습니다.");
    });
  }, []);

  async function handlePickFolder() {
    setError(null);

    if (!folderSupported || !window.showDirectoryPicker) {
      setError("현재 브라우저는 폴더 선택 API를 지원하지 않습니다.");
      return;
    }

    try {
      const handle = await window.showDirectoryPicker();
      const extractedFiles = await collectFolderFiles(handle);

      setWorkingPath(handle.name);
      setFiles(extractedFiles);
    } catch (pickError) {
      if (pickError instanceof Error && pickError.name === "AbortError") {
        return;
      }

      setError(pickError instanceof Error ? pickError.message : "폴더를 읽지 못했습니다.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          domain,
          workingPath,
          sourceFiles: files,
        }),
      });

      const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setName("");
      setDomain("");
      setWorkingPath("");
      setFiles([]);
      setPreview(null);

      await loadProjects();
      await loadProject(payload.data.project.project.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "프로젝트를 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveContext() {
    if (!activeProject?.brandProfile) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/brand-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "approve",
          summary: activeProject.brandProfile.summary,
          audience: activeProject.brandProfile.audience,
          tone: activeProject.brandProfile.tone,
          cta: activeProject.brandProfile.cta,
          bannedTerms: activeProject.brandProfile.bannedTerms,
        }),
      });

      const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setActiveProject(payload.data.project);
      await loadProjects();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "컨텍스트 승인 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveContext() {
    if (!activeProject?.brandProfile) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/brand-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "draft",
          summary: activeProject.brandProfile.summary,
          audience: activeProject.brandProfile.audience,
          tone: activeProject.brandProfile.tone,
          cta: activeProject.brandProfile.cta,
          bannedTerms: activeProject.brandProfile.bannedTerms,
        }),
      });

      const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setActiveProject(payload.data.project);
      await loadProject(activeProject.project.id);
      await loadProjects();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "컨텍스트 임시 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateContent() {
    if (!activeProject?.project.id) {
      return;
    }

    const topic =
      activeProject.topics.find((item) => item.id === selectedTopicId)?.title ||
      studio?.draft.topic ||
      activeProject.topics[0]?.title;
    if (!topic) {
      setError("콘텐츠 생성에 사용할 주제가 없습니다.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/content-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          objective: studio?.draft.objective,
        }),
      });

      const payload = await parseJson<ApiResponse<{ studio: StudioDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setStudio(payload.data.studio);
      await loadProject(activeProject.project.id);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "콘텐츠 초안 생성에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const payload = await parseJson<ApiResponse<{ deleted: { id: string } }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      const responseList = await fetch("/api/projects", { cache: "no-store" });
      const listPayload = await parseJson<ApiResponse<{ projects: ProjectListItem[] }>>(responseList);

      if (!listPayload.ok) {
        throw new Error(listPayload.error.message);
      }

      setProjects(listPayload.data.projects);

      const nextProjectId =
        activeProject?.project.id === projectId
          ? listPayload.data.projects[0]?.id ?? null
          : activeProject?.project.id ?? null;

      if (!nextProjectId) {
        setActiveProject(null);
        setStudio(null);
        setSelectedTopicId(null);
      } else {
        await loadProject(nextProjectId);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "프로젝트 삭제에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleBrandProfileChange(field: EditableBrandProfileField, value: string) {
    setActiveProject((currentProject) => {
      if (!currentProject?.brandProfile) {
        return currentProject;
      }

      return {
        ...currentProject,
        brandProfile: {
          ...currentProject.brandProfile,
          [field]: value,
        },
      };
    });
  }

  function handleTopicSelect(topicId: string) {
    const nextTopic = activeProject?.topics.find((topic) => topic.id === topicId);

    if (!nextTopic) {
      return;
    }

    setSelectedTopicId(topicId);
    setStudio((currentStudio) => {
      if (!currentStudio) {
        return currentStudio;
      }

      return {
        ...currentStudio,
        draft: {
          ...currentStudio.draft,
          topic: nextTopic.title,
        },
      };
    });
  }

  function handleAssetChange(channel: ChannelKey, field: "title" | "body" | "cta", value: string) {
    setStudio((currentStudio) => {
      if (!currentStudio) {
        return currentStudio;
      }

      const assetExists = currentStudio.draft.assets.some((asset) => asset.channel === channel);
      const nextAssets = assetExists
        ? currentStudio.draft.assets.map((asset) =>
            asset.channel === channel ? { ...asset, [field]: value } : asset,
          )
        : [...currentStudio.draft.assets, { ...createEmptyAsset(channel), [field]: value }];

      return {
        ...currentStudio,
        draft: {
          ...currentStudio.draft,
          assets: nextAssets,
        },
      };
    });
  }

  async function handleSaveContent() {
    if (!activeProject?.project.id || !studio) {
      return;
    }

    const selectedTopic = activeProject.topics.find((topic) => topic.id === selectedTopicId)?.title;
    const topic = selectedTopic || studio.draft.topic;

    if (!topic) {
      setError("저장할 주제가 없습니다.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/content-jobs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          objective: studio.draft.objective,
          assets: studio.draft.assets,
        }),
      });

      const payload = await parseJson<ApiResponse<{ studio: StudioDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setStudio(payload.data.studio);
      await loadProject(activeProject.project.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "콘텐츠 초안 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="rule" />
            <span className="eyebrow">m-master</span>
            <h1 className="brand-title">Context-aware marketing OS</h1>
            <p className="brand-copy">
              작업 폴더 문서를 읽고 브랜드 컨텍스트를 만들며, 블로그 중심 멀티채널 초안을 운영하는 MVP입니다.
            </p>
          </div>
          <nav className="nav-list">
            <div className="nav-pill active">프로젝트 생성</div>
            <div className="nav-pill active">컨텍스트 승인</div>
            <div className="nav-pill active">추천 주제</div>
            <div className="nav-pill active">콘텐츠 스튜디오</div>
            <div className="nav-pill active">검수 패널</div>
          </nav>
        </aside>

        <section className="main-area">
          <div className="main-topbar">
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Web MVP Dashboard</p>
              <h2 className="hero-title">작업 폴더 분석부터 콘텐츠 초안까지 한 흐름으로</h2>
              <p className="hero-copy">
                브라우저에서 폴더를 선택해 문서를 읽고, 도메인과 함께 브랜드 컨텍스트 초안을 만든 뒤, 블로그 원문과 인스타그램·페이스북 파생 초안을 동시에 확인합니다.
              </p>
            </div>
            <div className="hero-actions">
              <div className="status-pill active">{projects.length} Projects</div>
              <div className="status-pill">{files.length} Files Loaded</div>
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="stack">
              <ProjectIntakeForm
                name={name}
                domain={domain}
                workingPath={workingPath}
                files={files}
                preview={preview}
                loading={loading}
                folderSupported={folderSupported}
                error={error}
                onNameChange={setName}
                onDomainChange={setDomain}
                onPickFolder={handlePickFolder}
                onPreview={requestPreview}
                onSubmit={handleSubmit}
              />
              <ProjectOverview
                projects={projects}
                activeProject={activeProject}
                loading={loading}
                onSelectProject={loadProject}
                onDeleteProject={handleDeleteProject}
                onBrandProfileChange={handleBrandProfileChange}
                onSaveContext={handleSaveContext}
                onApproveContext={handleApproveContext}
              />
            </div>
            <ContentStudio
              detail={activeProject}
              studio={studio}
              activeChannel={activeChannel}
              selectedTopicId={selectedTopicId}
              loading={loading}
              onChannelChange={setActiveChannel}
              onTopicSelect={handleTopicSelect}
              onAssetChange={handleAssetChange}
              onSaveContent={handleSaveContent}
              onGenerateContent={handleGenerateContent}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
