"use client";
import { useState, useCallback } from "react";
import type { StudioDetail, SeoComplianceResult, ChannelKey } from "../types";
import { apiPost, apiPatch } from "./use-api";

function computeLocalSeoCompliance(blogAsset: {
  title: string; body: string; hashtags: string; metaDescription?: string | null;
}): SeoComplianceResult {
  const items: SeoComplianceResult["items"] = [];
  let score = 100;

  // Title length
  const titleLen = (blogAsset.title || "").length;
  if (titleLen === 0) {
    items.push({ key: "title-length", label: "제목 존재", status: "fail", detail: "제목 없음" });
    score -= 15;
  } else if (titleLen > 60) {
    items.push({ key: "title-length", label: "제목 60자 이내", status: "warn", detail: `${titleLen}자` });
    score -= 8;
  } else {
    items.push({ key: "title-length", label: "제목 60자 이내", status: "pass", detail: `${titleLen}자` });
  }

  // Meta description
  const metaLen = (blogAsset.metaDescription || "").length;
  if (metaLen === 0) {
    items.push({ key: "meta-desc", label: "메타 설명", status: "warn", detail: "미작성" });
    score -= 10;
  } else if (metaLen > 155) {
    items.push({ key: "meta-desc", label: "메타 설명 155자 이내", status: "warn", detail: `${metaLen}자` });
    score -= 5;
  } else {
    items.push({ key: "meta-desc", label: "메타 설명 155자 이내", status: "pass", detail: `${metaLen}자` });
  }

  // Body length
  const bodyLen = blogAsset.body.length;
  if (bodyLen < 1500) {
    items.push({ key: "body-length", label: "본문 1,500자 이상", status: "fail", detail: `${bodyLen}자` });
    score -= 15;
  } else if (bodyLen > 2500) {
    items.push({ key: "body-length", label: "본문 2,500자 이내", status: "warn", detail: `${bodyLen}자` });
    score -= 5;
  } else {
    items.push({ key: "body-length", label: "본문 1,500~2,500자", status: "pass", detail: `${bodyLen}자` });
  }

  // Image cues
  const imageCues = (blogAsset.body.match(/\[이미지\s+\d+\]/g) || []).length;
  if (imageCues < 3) {
    items.push({ key: "image-cues", label: "이미지 3~5개", status: "warn", detail: `${imageCues}개` });
    score -= 10;
  } else if (imageCues > 5) {
    items.push({ key: "image-cues", label: "이미지 3~5개", status: "warn", detail: `${imageCues}개` });
    score -= 3;
  } else {
    items.push({ key: "image-cues", label: "이미지 3~5개", status: "pass", detail: `${imageCues}개` });
  }

  // H2 sections
  const h2Count = (blogAsset.body.match(/^## /gm) || []).length;
  if (h2Count < 3) {
    items.push({ key: "sections", label: "섹션(H2) 3~5개", status: "warn", detail: `${h2Count}개` });
    score -= 8;
  } else if (h2Count > 6) {
    items.push({ key: "sections", label: "섹션(H2) 3~5개", status: "warn", detail: `${h2Count}개` });
    score -= 3;
  } else {
    items.push({ key: "sections", label: "섹션(H2) 3~5개", status: "pass", detail: `${h2Count}개` });
  }

  // Hashtags
  const tagCount = (blogAsset.hashtags || "").split(",").filter(t => t.trim()).length;
  if (tagCount < 4) {
    items.push({ key: "hashtags", label: "해시태그 4~6개", status: "warn", detail: `${tagCount}개` });
    score -= 5;
  } else {
    items.push({ key: "hashtags", label: "해시태그 4~6개", status: "pass", detail: `${tagCount}개` });
  }

  return { score: Math.max(0, Math.min(100, score)), items };
}

export function useContentGeneration(params: {
  onStudioUpdate: (studio: StudioDetail) => void;
  onError: (msg: string) => void;
}) {
  const { onStudioUpdate, onError } = params;
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [seoCompliance, setSeoCompliance] = useState<SeoComplianceResult | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("blog");

  // Editing state for blog
  const [editingTitle, setEditingTitle] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const [editingCta, setEditingCta] = useState("");
  const [editingHashtags, setEditingHashtags] = useState("");
  const [hashtagBusy, setHashtagBusy] = useState(false);

  const hydrateEditor = useCallback((studio: StudioDetail) => {
    if (!studio?.draft?.assets) return;
    const blogAsset = studio.draft.assets.find(a => a.channel === "blog");
    if (blogAsset) {
      setEditingTitle(blogAsset.title);
      setEditingBody(blogAsset.body);
      setEditingCta(blogAsset.cta);
      setEditingHashtags(blogAsset.hashtags);
      setSeoCompliance(computeLocalSeoCompliance(blogAsset));
    }
  }, []);

  const updateSeoFromEditor = useCallback(() => {
    setSeoCompliance(computeLocalSeoCompliance({
      title: editingTitle,
      body: editingBody,
      hashtags: editingHashtags,
    }));
  }, [editingTitle, editingBody, editingHashtags]);

  const handleGenerate = useCallback(async (projectId: string, topicId?: string, topic?: string) => {
    setGenerateBusy(true);
    onError("");
    try {
      const data = await apiPost<{ studio: StudioDetail }>(
        `/api/projects/${projectId}/content-jobs`,
        { topicId, topic, derivationMode: "blog-first" }
      );
      onStudioUpdate(data.studio);
      hydrateEditor(data.studio);
    } catch (e) {
      onError(e instanceof Error ? e.message : "콘텐츠 생성에 실패했습니다.");
    } finally {
      setGenerateBusy(false);
    }
  }, [onStudioUpdate, onError, hydrateEditor]);

  const handleSave = useCallback(async (projectId: string, studio: StudioDetail) => {
    setSaveBusy(true);
    onError("");
    try {
      const assets = studio.draft.assets.map(a =>
        a.channel === "blog"
          ? { ...a, title: editingTitle, body: editingBody, cta: editingCta, hashtags: editingHashtags }
          : a
      );
      const data = await apiPatch<{ studio: StudioDetail }>(
        `/api/projects/${projectId}/content-jobs`,
        { topic: studio.draft.topic, objective: studio.draft.objective, assets }
      );
      onStudioUpdate(data.studio);
    } catch (e) {
      onError(e instanceof Error ? e.message : "콘텐츠 저장에 실패했습니다.");
    } finally {
      setSaveBusy(false);
    }
  }, [editingTitle, editingBody, editingCta, editingHashtags, onStudioUpdate, onError]);

  const handleGenerateHashtags = useCallback(async () => {
    if (!editingBody.trim() && !editingTitle.trim()) return;
    setHashtagBusy(true);
    try {
      // Extract keywords from title + body for hashtag generation
      const text = `${editingTitle} ${editingBody}`;
      // Remove markdown syntax, numbers, short words
      const words = text
        .replace(/[#*\[\](){}|`>_~=\-+]/g, " ")
        .replace(/https?:\/\/\S+/g, "")
        .split(/\s+/)
        .map((w) => w.replace(/[.,!?;:'"]/g, "").trim())
        .filter((w) => w.length >= 2);

      // Count frequency (skip common stopwords)
      const stopwords = new Set(["그리고", "또한", "하는", "있는", "이런", "그런", "대한", "위한", "통해", "에서", "으로", "하고", "이를", "것을", "수가", "때문", "무엇", "어떤", "있다", "없다", "한다", "된다", "것이", "합니다", "입니다", "있습니다"]);
      const freq = new Map<string, number>();
      for (const w of words) {
        if (stopwords.has(w) || /^\d+$/.test(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }

      // Sort by frequency, pick top 6
      const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
      const topKeywords = sorted.slice(0, 6).map(([word]) => `#${word}`);
      setEditingHashtags(topKeywords.join(" "));
    } finally {
      setHashtagBusy(false);
    }
  }, [editingTitle, editingBody]);

  return {
    selectedTopicId, setSelectedTopicId,
    generateBusy, saveBusy,
    seoCompliance,
    activeChannel, setActiveChannel,
    editingTitle, setEditingTitle,
    editingBody, setEditingBody,
    editingCta, setEditingCta,
    editingHashtags, setEditingHashtags,
    hashtagBusy,
    hydrateEditor,
    updateSeoFromEditor,
    handleGenerate,
    handleSave,
    handleGenerateHashtags,
  };
}
