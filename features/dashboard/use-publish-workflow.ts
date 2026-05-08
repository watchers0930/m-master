"use client";

import { useState } from "react";

import type {
  BlogPublishDraft,
  BlogPublishPackage,
  ChannelKey,
  ExportBundle,
  ExportPreviewState,
  ProjectDetail,
  WordPressPublishConfig,
  WordPressPublishResult,
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

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function triggerTextDownload(filename: string, content: string) {
  if (typeof document === "undefined") {
    throw new Error("현재 환경에서는 파일 다운로드를 지원하지 않습니다.");
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function hashtagsToWordPressTags(value?: string | null) {
  if (!value) {
    return "";
  }

  return [...new Set(value.split(",").map((item) => item.trim().replace(/^#/, "")).filter(Boolean))].join(", ");
}

export function usePublishWorkflow(params: {
  projectId?: string | null;
  onError: (message: string) => void;
  reloadProject: (projectId: string) => Promise<void>;
}) {
  const { projectId, onError, reloadProject } = params;
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportPreviewState>({
    bundle: null,
    activeView: "blog",
  });
  const [publishBusy, setPublishBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [publishPackage, setPublishPackage] = useState<BlogPublishPackage | null>(null);
  const [publishDraft, setPublishDraft] = useState<BlogPublishDraft>({
    title: "",
    slug: "",
    summary: "",
    bodyHtml: "",
  });
  const [wordpressResult, setWordpressResult] = useState<WordPressPublishResult | null>(null);
  const [wordpressConfig, setWordpressConfig] = useState<WordPressPublishConfig>({
    siteUrl: "",
    username: "",
    appPassword: "",
    status: "draft",
    categoryNames: "",
    tagNames: "",
  });
  const [settingsBusy, setSettingsBusy] = useState(false);

  function resetPublishState() {
    setCopyStatus(null);
    setPublishPackage(null);
    setPublishDraft({
      title: "",
      slug: "",
      summary: "",
      bodyHtml: "",
    });
    setWordpressResult(null);
    setWordpressConfig({
      siteUrl: "",
      username: "",
      appPassword: "",
      status: "draft",
      categoryNames: "",
      tagNames: "",
    });
    setExportPreview({
      bundle: null,
      activeView: "blog",
    });
  }

  function hydratePublishResult(detail?: ProjectDetail | null) {
    const latestContentJob = detail?.latestContentJob;
    const project = detail?.project;

    if (project) {
      setWordpressConfig((current) => ({
        ...current,
        siteUrl: project.wordpressSiteUrl || "",
        username: project.wordpressUsername || "",
        status: project.wordpressStatus === "publish" ? "publish" : "draft",
        categoryNames: project.wordpressCategoryNames || "",
        tagNames: project.wordpressTagNames || "",
      }));
    }

    if (
      latestContentJob?.publishProvider === "wordpress" &&
      latestContentJob.externalPostId &&
      latestContentJob.externalPostUrl
    ) {
      setWordpressResult({
        postId: Number(latestContentJob.externalPostId),
        link: latestContentJob.externalPostUrl,
        status: latestContentJob.status,
      });
      return;
    }

    setWordpressResult(null);
  }

  function handlePublishDraftChange(field: keyof BlogPublishDraft, value: string) {
    setPublishDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleExportChannel(channel: ChannelKey) {
    if (!projectId) {
      return;
    }

    onError("");
    setExportBusy(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        cache: "no-store",
      });
      const payload = await parseJson<ApiResponse<{ bundle: ExportBundle }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }
      setCopyStatus(null);
      setExportPreview({
        bundle: payload.data.bundle,
        activeView: channel,
      });
    } catch (exportError) {
      onError(exportError instanceof Error ? exportError.message : "채널 미리보기를 불러오지 못했습니다.");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleExportAll() {
    if (!projectId) {
      return;
    }

    onError("");
    setExportBusy(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        cache: "no-store",
      });
      const payload = await parseJson<ApiResponse<{ bundle: ExportBundle }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }
      setCopyStatus(null);
      setExportPreview({
        bundle: payload.data.bundle,
        activeView: "json",
      });
    } catch (exportError) {
      onError(exportError instanceof Error ? exportError.message : "전체 JSON 보기를 불러오지 못했습니다.");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCopyExportPreview() {
    if (!exportPreview.bundle || typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyStatus("복사할 결과가 없거나 현재 환경에서 클립보드 복사를 지원하지 않습니다.");
      return;
    }

    setCopyStatus(null);
    setCopyBusy(true);

    try {
      const copyText =
        exportPreview.activeView === "json"
          ? JSON.stringify(exportPreview.bundle, null, 2)
          : exportPreview.bundle.channels.find((item) => item.channel === exportPreview.activeView)?.content || "";

      if (!copyText) {
        throw new Error("복사할 텍스트가 없습니다.");
      }

      await navigator.clipboard.writeText(copyText);
      setCopyStatus(
        exportPreview.activeView === "json"
          ? "전체 JSON을 클립보드에 복사했습니다."
          : `${exportPreview.activeView} 결과를 클립보드에 복사했습니다.`,
      );
    } catch (copyError) {
      setCopyStatus(copyError instanceof Error ? copyError.message : "클립보드 복사에 실패했습니다.");
    } finally {
      setCopyBusy(false);
    }
  }

  async function handleDownloadExportContent() {
    if (!exportPreview.bundle || exportPreview.activeView === "json") {
      setCopyStatus("다운로드할 채널 결과를 먼저 선택하세요.");
      return;
    }

    const activeChannel = exportPreview.bundle.channels.find((item) => item.channel === exportPreview.activeView);
    if (!activeChannel) {
      setCopyStatus("다운로드할 채널 결과가 없습니다.");
      return;
    }

    try {
      triggerTextDownload(activeChannel.filename, activeChannel.content);
      setCopyStatus(`${activeChannel.filename} 파일을 다운로드했습니다.`);
    } catch (downloadError) {
      setCopyStatus(downloadError instanceof Error ? downloadError.message : "본문 파일 다운로드에 실패했습니다.");
    }
  }

  async function handleDownloadExportHashtags() {
    if (!exportPreview.bundle || exportPreview.activeView === "json") {
      setCopyStatus("다운로드할 채널 결과를 먼저 선택하세요.");
      return;
    }

    const activeChannel = exportPreview.bundle.channels.find((item) => item.channel === exportPreview.activeView);
    if (!activeChannel) {
      setCopyStatus("다운로드할 채널 결과가 없습니다.");
      return;
    }

    if (!activeChannel.hashtagsFilename) {
      setCopyStatus("이 채널은 별도 해시태그 파일을 제공하지 않습니다.");
      return;
    }

    try {
      triggerTextDownload(activeChannel.hashtagsFilename, activeChannel.hashtags || "");
      setCopyStatus(`${activeChannel.hashtagsFilename} 파일을 다운로드했습니다.`);
    } catch (downloadError) {
      setCopyStatus(downloadError instanceof Error ? downloadError.message : "해시태그 파일 다운로드에 실패했습니다.");
    }
  }

  async function handleCopyBlogPublishHtml() {
    if (!publishPackage || typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyStatus("복사할 블로그 등록 패키지가 없거나 현재 환경에서 클립보드 복사를 지원하지 않습니다.");
      return;
    }

    setCopyStatus(null);
    setCopyBusy(true);

    try {
      const htmlToCopy = publishDraft.bodyHtml || publishPackage.bodyHtml;
      await navigator.clipboard.writeText(htmlToCopy);
      setCopyStatus("블로그 HTML 본문을 클립보드에 복사했습니다.");
    } catch (copyError) {
      setCopyStatus(copyError instanceof Error ? copyError.message : "블로그 HTML 복사에 실패했습니다.");
    } finally {
      setCopyBusy(false);
    }
  }

  function handleWordPressConfigChange(field: keyof WordPressPublishConfig, value: string) {
    setWordpressConfig((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleExportPreviewViewChange(view: ChannelKey | "json") {
    setExportPreview((current) => ({
      bundle: current.bundle,
      activeView: view,
    }));
  }

  async function handlePreparePublish() {
    if (!projectId) {
      return;
    }

    onError("");
    setPublishBusy(true);

    try {
      const hasWordPressCredentials = Boolean(
        publishPackage &&
          wordpressConfig.siteUrl &&
          wordpressConfig.username &&
          wordpressConfig.appPassword,
      );
      const response = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wordpress: hasWordPressCredentials
            ? {
                siteUrl: wordpressConfig.siteUrl,
                username: wordpressConfig.username,
                appPassword: wordpressConfig.appPassword,
                status: wordpressConfig.status,
                categoryNames: wordpressConfig.categoryNames,
                tagNames: wordpressConfig.tagNames,
              }
            : undefined,
          publishOverrides: {
            title: publishDraft.title,
            slug: publishDraft.slug,
            summary: publishDraft.summary,
            bodyHtml: publishDraft.bodyHtml,
          },
        }),
      });
      const payload = await parseJson<
        ApiResponse<{
          publish: {
            status: string;
            publishPackage: BlogPublishPackage;
            wordpress?: WordPressPublishResult | null;
          };
        }>
      >(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      await reloadProject(projectId);
      setPublishPackage(payload.data.publish.publishPackage);
      setPublishDraft({
        title: payload.data.publish.publishPackage.title,
        slug: payload.data.publish.publishPackage.slug,
        summary: payload.data.publish.publishPackage.summary,
        bodyHtml: payload.data.publish.publishPackage.bodyHtml,
      });
      setWordpressConfig((current) => ({
        ...current,
        tagNames: current.tagNames || hashtagsToWordPressTags(payload.data.publish.publishPackage.hashtags),
      }));
      setWordpressResult(payload.data.publish.wordpress ?? null);
    } catch (publishError) {
      onError(publishError instanceof Error ? publishError.message : "발행 준비 처리에 실패했습니다.");
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleSaveWordPressDefaults() {
    if (!projectId) {
      return;
    }

    onError("");
    setSettingsBusy(true);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wordpressSiteUrl: wordpressConfig.siteUrl,
          wordpressUsername: wordpressConfig.username,
          wordpressStatus: wordpressConfig.status,
          wordpressCategoryNames: wordpressConfig.categoryNames,
          wordpressTagNames: wordpressConfig.tagNames,
        }),
      });
      const payload = await parseJson<ApiResponse<{ project: ProjectDetail }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      await reloadProject(projectId);
    } catch (settingsError) {
      onError(settingsError instanceof Error ? settingsError.message : "워드프레스 기본값 저장에 실패했습니다.");
    } finally {
      setSettingsBusy(false);
    }
  }

  return {
    exportBusy,
    exportPreview,
    publishBusy,
    copyBusy,
    copyStatus,
    publishPackage,
    publishDraft,
    wordpressResult,
    wordpressConfig,
    settingsBusy,
    resetPublishState,
    hydratePublishResult,
    handlePublishDraftChange,
    handleExportChannel,
    handleExportAll,
    handleCopyExportPreview,
    handleDownloadExportContent,
    handleDownloadExportHashtags,
    handleCopyBlogPublishHtml,
    handleWordPressConfigChange,
    handleExportPreviewViewChange,
    handlePreparePublish,
    handleSaveWordPressDefaults,
  };
}
