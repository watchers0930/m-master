"use client";
import { useEffect, useState } from "react";

import { ContentStudio } from "@/features/dashboard/content-studio";
import { ProjectIntakeForm } from "@/features/dashboard/project-intake-form";
import { ProjectOverview } from "@/features/dashboard/project-overview";
import { usePublishWorkflow } from "@/features/dashboard/use-publish-workflow";
import type {
  ChannelKey,
  EditableBrandProfileField,
  ImageStudioState,
  ImageStudioVariant,
  ProjectActivityItem,
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
    hashtags: "",
  };
}

function createEmptyImageStudio(): Record<ChannelKey, ImageStudioState> {
  return {
    blog: { prompt: "", variants: [], selectedVariantId: null },
    instagram: { prompt: "", variants: [], selectedVariantId: null },
    facebook: { prompt: "", variants: [], selectedVariantId: null },
  };
}

function toImageStudios(studio: StudioDetail | null): Record<ChannelKey, ImageStudioState> {
  const empty = createEmptyImageStudio();

  if (!studio) {
    return empty;
  }

  for (const imageGroup of studio.draft.images) {
    const variants: ImageStudioVariant[] = imageGroup.variants.map((variant, index) => ({
      id: variant.id,
      label: `Variation ${index + 1}`,
      prompt: imageGroup.prompt || "",
      url: variant.url,
      selected: variant.selected,
      accent: "#0071e3",
    }));

    empty[imageGroup.channel] = {
      prompt: imageGroup.prompt || "",
      variants,
      selectedVariantId: imageGroup.variants.find((variant) => variant.selected)?.id ?? variants[0]?.id ?? null,
    };
  }

  return empty;
}

export function DashboardShell() {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [studio, setStudio] = useState<StudioDetail | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("blog");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [history, setHistory] = useState<ProjectActivityItem[]>([]);
  const [imageStudios, setImageStudios] = useState<Record<ChannelKey, ImageStudioState>>(createEmptyImageStudio());
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("general");
  const [workingPath, setWorkingPath] = useState("");
  const [files, setFiles] = useState<SourceFileDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [folderSupported, setFolderSupported] = useState<boolean | null>(null);

  const currentImageStudio = imageStudios[activeChannel];
  const contextApproved = Boolean(activeProject?.brandProfile?.approved);
  const onboardingMode = !activeProject && projects.length === 0 && currentStep === 1;
  const stepAvailability = {
    1: true,
    2: Boolean(activeProject),
    3: Boolean(contextApproved && activeProject?.topics.length),
    4: Boolean(contextApproved && activeProject && studio),
    5: Boolean(contextApproved && activeProject && studio),
    6: Boolean(contextApproved && activeProject && studio),
  } as const;
  const stepMeta = [
    { step: 1 as const, title: "사이트 등록", description: "사이트 URL과 참고 자료를 연결합니다." },
    { step: 2 as const, title: "콘텍스트 정리", description: "사이트에서 읽은 브랜드 콘텍스트를 확인합니다." },
    { step: 3 as const, title: "테마 선택", description: "이번에 만들 콘텐츠의 작성 테마를 고릅니다." },
    { step: 4 as const, title: "채널별 문안", description: "블로그, 인스타그램, 페이스북 초안을 생성하고 수정합니다." },
    { step: 5 as const, title: "이미지 생성", description: "채널 문안에 맞는 대표 이미지를 만듭니다." },
    { step: 6 as const, title: "복사/발행 준비", description: "최종 결과를 복사하거나 매체 등록 준비로 넘깁니다." },
  ];
  const publishWorkflow = usePublishWorkflow({
    projectId: activeProject?.project.id ?? null,
    onError: (message) => setError(message || null),
    reloadProject: loadProject,
  });

  useEffect(() => {
    if (!contextApproved && currentStep > 2) {
      setCurrentStep(2);
    }
  }, [contextApproved, currentStep]);

  function goToStep(step: 1 | 2 | 3 | 4 | 5 | 6) {
    if (!stepAvailability[step]) {
      return;
    }

    setCurrentStep(step);
  }

  function applyProjectDetail(nextProject: ProjectDetail) {
    setActiveProject(nextProject);
    publishWorkflow.hydratePublishResult(nextProject);
  }

  function applyStudioDetail(nextStudio: StudioDetail, nextProject?: ProjectDetail | null) {
    const topicSource = nextProject ?? activeProject;
    const matchedTopic =
      topicSource?.topics.find((topic) => topic.title === nextStudio.draft.topic) ||
      topicSource?.topics[0] ||
      null;

    setStudio(nextStudio);
    setSelectedTopicId(matchedTopic?.id ?? null);
    setImageStudios(toImageStudios(nextStudio));
  }

  async function loadProjectDetail(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    applyProjectDetail(payload.data.project);
    return payload.data.project;
  }

  async function loadProjectStudio(projectId: string, nextProject?: ProjectDetail | null) {
    const response = await fetch(`/api/projects/${projectId}/studio`, { cache: "no-store" });
    const payload = await parseJson<ApiResponse<{ studio: StudioDetail }>>(response);

    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    applyStudioDetail(payload.data.studio, nextProject);
    return payload.data.studio;
  }

  async function loadProjectHistory(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}/history`, { cache: "no-store" });
    const payload = await parseJson<ApiResponse<{ history: ProjectActivityItem[] }>>(response);

    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    setHistory(payload.data.history);
    return payload.data.history;
  }

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
    const [nextProject] = await Promise.all([
      loadProjectDetail(projectId),
      loadProjectHistory(projectId),
    ]);
    await loadProjectStudio(projectId, nextProject);
    publishWorkflow.resetPublishState();
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
          industry,
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
    setFolderSupported(typeof window !== "undefined" && typeof window.showDirectoryPicker === "function");
  }, []);

  async function handlePickFolder() {
    setError(null);

    if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
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
          industry,
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
      setIndustry("general");
      setWorkingPath("");
      setFiles([]);
      setPreview(null);

      await loadProjects();
      await loadProject(payload.data.project.project.id);
      setCurrentStep(2);
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

      applyProjectDetail(payload.data.project);
      await loadProjectHistory(activeProject.project.id);
      await loadProjects();
      setCurrentStep(3);
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

      applyProjectDetail(payload.data.project);
      await loadProjectHistory(activeProject.project.id);
      await loadProjects();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "컨텍스트 임시 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerateContext() {
    if (!activeProject?.project.id) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/brand-profile`, {
        method: "POST",
      });
      const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      applyProjectDetail(payload.data.project);
      setSelectedTopicId(payload.data.project.topics[0]?.id ?? null);
      await loadProjectHistory(activeProject.project.id);
      await loadProjects();
      setCurrentStep(2);
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : "컨텍스트 재생성에 실패했습니다.");
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

      applyStudioDetail(payload.data.studio);
      await Promise.all([
        loadProjectDetail(activeProject.project.id),
        loadProjectHistory(activeProject.project.id),
      ]);
      setCurrentStep(4);
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
        setCurrentStep(1);
      } else {
        await loadProject(nextProjectId);
        setCurrentStep(2);
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

  function handleProjectIndustryChange(value: string) {
    setActiveProject((currentProject) => {
      if (!currentProject) {
        return currentProject;
      }

      return {
        ...currentProject,
        project: {
          ...currentProject.project,
          industry: value,
        },
      };
    });
  }

  async function handleSaveProjectSettings() {
    if (!activeProject?.project.id) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: activeProject.project.industry || "general",
          wordpressSiteUrl: activeProject.project.wordpressSiteUrl,
          wordpressUsername: activeProject.project.wordpressUsername,
          wordpressStatus: activeProject.project.wordpressStatus,
          wordpressCategoryNames: activeProject.project.wordpressCategoryNames,
          wordpressTagNames: activeProject.project.wordpressTagNames,
        }),
      });

      const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      applyProjectDetail(payload.data.project);
      await loadProjects();
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "프로젝트 설정 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
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

  function handleAssetChange(channel: ChannelKey, field: "title" | "body" | "cta" | "hashtags", value: string) {
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

  function updateImageStudio(channel: ChannelKey, updater: (current: ImageStudioState) => ImageStudioState) {
    setImageStudios((currentStudios) => ({
      ...currentStudios,
      [channel]: updater(currentStudios[channel]),
    }));
  }

  function handleImagePromptChange(value: string) {
    updateImageStudio(activeChannel, (currentStudio) => ({
      ...currentStudio,
      prompt: value,
    }));
  }

  async function handleGenerateImages() {
    if (!activeProject?.project.id) {
      return;
    }

    setError(null);
    setImageBusy(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: activeChannel,
          prompt: currentImageStudio.prompt,
        }),
      });
      const payload = await parseJson<ApiResponse<{ studio: StudioDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      applyStudioDetail(payload.data.studio);
      setCurrentStep(6);
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "이미지 생성에 실패했습니다.");
    } finally {
      setImageBusy(false);
    }
  }

  function handleSelectImageVariant(variantId: string) {
    updateImageStudio(activeChannel, (currentStudio) => ({
      ...currentStudio,
      selectedVariantId: variantId,
    }));
  }

  async function handleApplyImageVariant(variantId: string) {
    if (!activeProject?.project.id) {
      return;
    }

    setError(null);
    setImageBusy(true);

    try {
      const response = await fetch(`/api/projects/${activeProject.project.id}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: activeChannel,
          imageAssetId: variantId,
        }),
      });
      const payload = await parseJson<ApiResponse<{ studio: StudioDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      applyStudioDetail(payload.data.studio);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "이미지 선택 적용에 실패했습니다.");
    } finally {
      setImageBusy(false);
    }
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

      applyStudioDetail(payload.data.studio);
      await Promise.all([
        loadProjectDetail(activeProject.project.id),
        loadProjectHistory(activeProject.project.id),
      ]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "콘텐츠 초안 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleJumpToReviewTarget(finding: StudioDetail["review"]["findings"][number]) {
    if (finding.channel === "blog" || finding.channel === "instagram" || finding.channel === "facebook") {
      setActiveChannel(finding.channel);
    }

    if (finding.type === "cta" || finding.type === "brand" || finding.type === "format") {
      setCurrentStep(4);
      return;
    }

    setCurrentStep(2);
  }

  const currentStepMeta = stepMeta.find((item) => item.step === currentStep) || stepMeta[0];
  const previousStep = currentStep > 1 ? ((currentStep - 1) as 1 | 2 | 3 | 4 | 5) : null;
  const nextStep = currentStep < 6 ? ((currentStep + 1) as 2 | 3 | 4 | 5 | 6) : null;
  const journeyLabels = ["URL 입력", "콘텍스트 정리", "테마 선택", "채널 작성", "이미지 생성", "복사/발행"] as const;
  const stepFocusCopy = {
    1: "사이트 주소를 넣고 분석을 시작합니다. 필요하면 소개 자료 폴더를 함께 연결합니다.",
    2: "브랜드 콘텍스트를 확인하고 이 프로젝트의 기준 문장으로 정리합니다.",
    3: "이번에 만들 콘텐츠 테마를 하나 고른 뒤 채널별 초안을 생성합니다.",
    4: "블로그, 인스타그램, 페이스북 문안을 채널별로 다듬고 저장합니다.",
    5: "선택한 채널 문안에 맞는 이미지 시안을 만들고 대표안을 고릅니다.",
    6: "최종 결과를 확인한 뒤 복사해서 바로 쓰거나 매체 등록 준비로 넘깁니다.",
  } as const;

  return (
    <main className="app-shell">
      <div className={`app-frame ${onboardingMode ? "onboarding-mode" : ""}`}>
        <aside className={`sidebar ${onboardingMode ? "compact" : ""}`}>
          <div className="sidebar-brand">
            <div className="rule" />
            <span className="eyebrow">m-master</span>
            <h1 className="brand-title">Website To Content Pipeline</h1>
            <p className="brand-copy">
              사이트 URL에서 브랜드 콘텍스트를 읽고, 테마를 고른 뒤 채널별 콘텐츠와 이미지까지 만드는 순차형 작업 화면입니다.
            </p>
          </div>
          {onboardingMode ? (
            <div className="onboarding-copy">
              <strong>처음에는 프로젝트 이름과 사이트 주소면 충분합니다.</strong>
              <p className="fine-print">사이트를 읽어 콘텍스트와 작성 테마를 만들고, 이후 단계에서 블로그, 인스타그램, 페이스북 콘텐츠를 생성합니다.</p>
            </div>
          ) : (
            <nav className="wizard-nav">
              {stepMeta.map((item) => (
                <button
                  key={item.step}
                  className={`wizard-nav-item ${currentStep === item.step ? "active" : ""}`}
                  disabled={!stepAvailability[item.step]}
                  type="button"
                  onClick={() => goToStep(item.step)}
                >
                  <span className="wizard-nav-step">{`Step ${item.step}`}</span>
                  <strong>{item.title}</strong>
                  <span className="fine-print">{item.description}</span>
                </button>
              ))}
            </nav>
          )}
        </aside>

        <section className="main-area">
          <div className="main-topbar">
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Content Workflow</p>
              <h2 className="hero-title">{currentStepMeta.title}</h2>
              <p className="hero-copy">
                {currentStepMeta.description} 사용자는 URL 입력부터 최종 복사/발행 준비까지 이 흐름대로 진행합니다.
              </p>
            </div>
            {!onboardingMode ? (
              <div className="hero-actions">
                <div className="status-pill active">{projects.length} Projects</div>
                <div className="status-pill">{files.length} Docs</div>
                <div className="status-pill">{`Step ${currentStep}/6`}</div>
              </div>
            ) : null}
          </div>

          <div className="wizard-stage">
            {error ? <p className="error-text wizard-error">{error}</p> : null}
            <div className="journey-strip">
              {journeyLabels.map((label, index) => (
                <div className={`journey-node ${currentStep >= index + 1 ? "active" : ""}`} key={label}>
                  {label}
                </div>
              ))}
            </div>
            <div className="step-focus-banner">
              <strong>{`Step ${currentStep}에서 할 일`}</strong>
              <p className="fine-print">{stepFocusCopy[currentStep]}</p>
            </div>
            {!activeProject ? (
              <p className="fine-print">
                Step 2-6은 프로젝트를 만든 뒤 순서대로 열립니다. 먼저 프로젝트를 생성하고 컨텍스트 승인 단계까지 진행해야 콘텐츠 작업이 시작됩니다.
              </p>
            ) : null}
            {!contextApproved && activeProject ? (
              <p className="fine-print">
                컨텍스트 승인 전에는 Step 3-6이 잠깁니다. Step 2에서 브랜드 프로필을 승인해야 콘텐츠 단계로 이동할 수 있습니다.
              </p>
            ) : null}

            {currentStep === 1 ? (
              <ProjectIntakeForm
                name={name}
                domain={domain}
                industry={industry}
                workingPath={workingPath}
                files={files}
                preview={preview}
                loading={loading}
                folderSupported={folderSupported}
                error={error}
                onNameChange={setName}
                onDomainChange={setDomain}
                onIndustryChange={setIndustry}
                onPickFolder={handlePickFolder}
                onPreview={requestPreview}
                onSubmit={handleSubmit}
              />
            ) : null}

            {currentStep === 2 ? (
              <ProjectOverview
                projects={projects}
                activeProject={activeProject}
                loading={loading}
                onSelectProject={loadProject}
                onDeleteProject={handleDeleteProject}
                onRegenerateContext={handleRegenerateContext}
                onProjectIndustryChange={handleProjectIndustryChange}
                onSaveProjectSettings={handleSaveProjectSettings}
                onBrandProfileChange={handleBrandProfileChange}
                onSaveContext={handleSaveContext}
                onApproveContext={handleApproveContext}
              />
            ) : null}

            {currentStep === 3 ? (
              <ContentStudio
                detail={activeProject}
                studio={studio}
                imageStudio={currentImageStudio}
                history={history}
                imageBusy={imageBusy}
                exportBusy={publishWorkflow.exportBusy}
                publishBusy={publishWorkflow.publishBusy}
                settingsBusy={publishWorkflow.settingsBusy}
                exportPreview={publishWorkflow.exportPreview}
                activeChannel={activeChannel}
                selectedTopicId={selectedTopicId}
                loading={loading}
                copyBusy={publishWorkflow.copyBusy}
                copyStatus={publishWorkflow.copyStatus}
                publishPackage={publishWorkflow.publishPackage}
                publishDraft={publishWorkflow.publishDraft}
                wordpressConfig={publishWorkflow.wordpressConfig}
                wordpressResult={publishWorkflow.wordpressResult}
                onChannelChange={setActiveChannel}
                onTopicSelect={handleTopicSelect}
                onAssetChange={handleAssetChange}
                onImagePromptChange={handleImagePromptChange}
                onGenerateImages={handleGenerateImages}
                onSelectImageVariant={handleSelectImageVariant}
                onApplyImageVariant={handleApplyImageVariant}
                onSaveContent={handleSaveContent}
                onGenerateContent={handleGenerateContent}
                onExportChannel={publishWorkflow.handleExportChannel}
                onExportAll={publishWorkflow.handleExportAll}
                onExportPreviewViewChange={publishWorkflow.handleExportPreviewViewChange}
                onPreparePublish={publishWorkflow.handlePreparePublish}
                onSaveWordPressDefaults={publishWorkflow.handleSaveWordPressDefaults}
                onCopyExportPreview={publishWorkflow.handleCopyExportPreview}
                onDownloadExportContent={publishWorkflow.handleDownloadExportContent}
                onDownloadExportHashtags={publishWorkflow.handleDownloadExportHashtags}
                onCopyBlogPublishHtml={publishWorkflow.handleCopyBlogPublishHtml}
                onPublishDraftChange={publishWorkflow.handlePublishDraftChange}
                onWordPressConfigChange={publishWorkflow.handleWordPressConfigChange}
                onContinueWithTopic={handleGenerateContent}
                onJumpToReviewTarget={handleJumpToReviewTarget}
                showTopics
                showContent={false}
                showImages={false}
                showReview={false}
                showOps={false}
              />
            ) : null}

            {currentStep === 4 ? (
              <ContentStudio
                detail={activeProject}
                studio={studio}
                imageStudio={currentImageStudio}
                history={history}
                imageBusy={imageBusy}
                exportBusy={publishWorkflow.exportBusy}
                publishBusy={publishWorkflow.publishBusy}
                settingsBusy={publishWorkflow.settingsBusy}
                exportPreview={publishWorkflow.exportPreview}
                activeChannel={activeChannel}
                selectedTopicId={selectedTopicId}
                loading={loading}
                copyBusy={publishWorkflow.copyBusy}
                copyStatus={publishWorkflow.copyStatus}
                publishPackage={publishWorkflow.publishPackage}
                publishDraft={publishWorkflow.publishDraft}
                wordpressConfig={publishWorkflow.wordpressConfig}
                wordpressResult={publishWorkflow.wordpressResult}
                onChannelChange={setActiveChannel}
                onTopicSelect={handleTopicSelect}
                onAssetChange={handleAssetChange}
                onImagePromptChange={handleImagePromptChange}
                onGenerateImages={handleGenerateImages}
                onSelectImageVariant={handleSelectImageVariant}
                onApplyImageVariant={handleApplyImageVariant}
                onSaveContent={handleSaveContent}
                onGenerateContent={handleGenerateContent}
                onExportChannel={publishWorkflow.handleExportChannel}
                onExportAll={publishWorkflow.handleExportAll}
                onExportPreviewViewChange={publishWorkflow.handleExportPreviewViewChange}
                onPreparePublish={publishWorkflow.handlePreparePublish}
                onSaveWordPressDefaults={publishWorkflow.handleSaveWordPressDefaults}
                onCopyExportPreview={publishWorkflow.handleCopyExportPreview}
                onDownloadExportContent={publishWorkflow.handleDownloadExportContent}
                onDownloadExportHashtags={publishWorkflow.handleDownloadExportHashtags}
                onCopyBlogPublishHtml={publishWorkflow.handleCopyBlogPublishHtml}
                onPublishDraftChange={publishWorkflow.handlePublishDraftChange}
                onWordPressConfigChange={publishWorkflow.handleWordPressConfigChange}
                onContinueWithTopic={handleGenerateContent}
                onJumpToReviewTarget={handleJumpToReviewTarget}
                showTopics={false}
                showContent
                showImages={false}
                showReview={false}
                showOps={false}
              />
            ) : null}

            {currentStep === 5 ? (
              <ContentStudio
                detail={activeProject}
                studio={studio}
                imageStudio={currentImageStudio}
                history={history}
                imageBusy={imageBusy}
                exportBusy={publishWorkflow.exportBusy}
                publishBusy={publishWorkflow.publishBusy}
                settingsBusy={publishWorkflow.settingsBusy}
                exportPreview={publishWorkflow.exportPreview}
                activeChannel={activeChannel}
                selectedTopicId={selectedTopicId}
                loading={loading}
                copyBusy={publishWorkflow.copyBusy}
                copyStatus={publishWorkflow.copyStatus}
                publishPackage={publishWorkflow.publishPackage}
                publishDraft={publishWorkflow.publishDraft}
                wordpressConfig={publishWorkflow.wordpressConfig}
                wordpressResult={publishWorkflow.wordpressResult}
                onChannelChange={setActiveChannel}
                onTopicSelect={handleTopicSelect}
                onAssetChange={handleAssetChange}
                onImagePromptChange={handleImagePromptChange}
                onGenerateImages={handleGenerateImages}
                onSelectImageVariant={handleSelectImageVariant}
                onApplyImageVariant={handleApplyImageVariant}
                onSaveContent={handleSaveContent}
                onGenerateContent={handleGenerateContent}
                onExportChannel={publishWorkflow.handleExportChannel}
                onExportAll={publishWorkflow.handleExportAll}
                onExportPreviewViewChange={publishWorkflow.handleExportPreviewViewChange}
                onPreparePublish={publishWorkflow.handlePreparePublish}
                onSaveWordPressDefaults={publishWorkflow.handleSaveWordPressDefaults}
                onCopyExportPreview={publishWorkflow.handleCopyExportPreview}
                onDownloadExportContent={publishWorkflow.handleDownloadExportContent}
                onDownloadExportHashtags={publishWorkflow.handleDownloadExportHashtags}
                onCopyBlogPublishHtml={publishWorkflow.handleCopyBlogPublishHtml}
                onPublishDraftChange={publishWorkflow.handlePublishDraftChange}
                onWordPressConfigChange={publishWorkflow.handleWordPressConfigChange}
                onContinueWithTopic={handleGenerateContent}
                onJumpToReviewTarget={handleJumpToReviewTarget}
                showTopics={false}
                showContent={false}
                showImages
                showReview={false}
                showOps={false}
              />
            ) : null}

            {currentStep === 6 ? (
              <ContentStudio
                detail={activeProject}
                studio={studio}
                imageStudio={currentImageStudio}
                history={history}
                imageBusy={imageBusy}
                exportBusy={publishWorkflow.exportBusy}
                publishBusy={publishWorkflow.publishBusy}
                settingsBusy={publishWorkflow.settingsBusy}
                exportPreview={publishWorkflow.exportPreview}
                activeChannel={activeChannel}
                selectedTopicId={selectedTopicId}
                loading={loading}
                copyBusy={publishWorkflow.copyBusy}
                copyStatus={publishWorkflow.copyStatus}
                publishPackage={publishWorkflow.publishPackage}
                publishDraft={publishWorkflow.publishDraft}
                wordpressConfig={publishWorkflow.wordpressConfig}
                wordpressResult={publishWorkflow.wordpressResult}
                onChannelChange={setActiveChannel}
                onTopicSelect={handleTopicSelect}
                onAssetChange={handleAssetChange}
                onImagePromptChange={handleImagePromptChange}
                onGenerateImages={handleGenerateImages}
                onSelectImageVariant={handleSelectImageVariant}
                onApplyImageVariant={handleApplyImageVariant}
                onSaveContent={handleSaveContent}
                onGenerateContent={handleGenerateContent}
                onExportChannel={publishWorkflow.handleExportChannel}
                onExportAll={publishWorkflow.handleExportAll}
                onExportPreviewViewChange={publishWorkflow.handleExportPreviewViewChange}
                onPreparePublish={publishWorkflow.handlePreparePublish}
                onSaveWordPressDefaults={publishWorkflow.handleSaveWordPressDefaults}
                onCopyExportPreview={publishWorkflow.handleCopyExportPreview}
                onDownloadExportContent={publishWorkflow.handleDownloadExportContent}
                onDownloadExportHashtags={publishWorkflow.handleDownloadExportHashtags}
                onCopyBlogPublishHtml={publishWorkflow.handleCopyBlogPublishHtml}
                onPublishDraftChange={publishWorkflow.handlePublishDraftChange}
                onWordPressConfigChange={publishWorkflow.handleWordPressConfigChange}
                onContinueWithTopic={handleGenerateContent}
                onJumpToReviewTarget={handleJumpToReviewTarget}
                showTopics={false}
                showContent={false}
                showImages={false}
                showReview
                showOps
              />
            ) : null}
          </div>

          {!onboardingMode ? (
            <div className="wizard-footer">
              <div className="wizard-footer-copy">
                <strong>{currentStepMeta.title}</strong>
                <span className="fine-print">{currentStepMeta.description}</span>
              </div>
              <div className="button-cluster">
                {previousStep ? (
                  <button className="button ghost" type="button" onClick={() => goToStep(previousStep)}>
                    이전 단계
                  </button>
                ) : null}
                {nextStep ? (
                  <button
                    className="button primary"
                    disabled={!stepAvailability[nextStep]}
                    type="button"
                    onClick={() => goToStep(nextStep)}
                  >
                    다음 단계
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
