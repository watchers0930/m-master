"use client";
import { useState, useCallback } from "react";
import type { SourceFileDraft, ProjectDetail, SourceAnalysisSummary, ProjectPreview } from "../types";
import { apiPost, apiPatch, apiGet } from "./use-api";

export function useSourceRegistration(params: {
  onProjectCreated: (project: ProjectDetail) => void;
  onError: (msg: string) => void;
}) {
  const { onProjectCreated, onError } = params;
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [workingPath, setWorkingPath] = useState("");
  const [sourceFiles, setSourceFiles] = useState<SourceFileDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);

  // Context editing
  const [editingSummary, setEditingSummary] = useState("");
  const [editingAudience, setEditingAudience] = useState("");
  const [editingTone, setEditingTone] = useState("");
  const [editingCta, setEditingCta] = useState("");
  const [editingBannedTerms, setEditingBannedTerms] = useState("");
  const [contextBusy, setContextBusy] = useState(false);

  const handleCreateProject = useCallback(async () => {
    if (!name.trim()) {
      onError("프로젝트 이름은 필수입니다.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const data = await apiPost<{ project: ProjectDetail }>("/api/projects", {
        name: name.trim(),
        domain: domain.trim() || undefined,
        industry: industry.trim() || undefined,
        workingPath: workingPath.trim() || undefined,
        sourceFiles,
      });
      onProjectCreated(data.project);
    } catch (e) {
      onError(e instanceof Error ? e.message : "프로젝트 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }, [name, domain, industry, workingPath, sourceFiles, onProjectCreated, onError]);

  const hydrateContextForm = useCallback((project: ProjectDetail) => {
    const bp = project.brandProfile;
    setEditingSummary(bp?.summary || "");
    setEditingAudience(bp?.audience || "");
    setEditingTone(bp?.tone || "");
    setEditingCta(bp?.cta || "");
    setEditingBannedTerms(bp?.bannedTerms || "");
  }, []);

  const handleApproveContext = useCallback(async (projectId: string) => {
    setContextBusy(true);
    onError("");
    try {
      const data = await apiPatch<{ project: ProjectDetail }>(
        `/api/projects/${projectId}/brand-profile`,
        {
          action: "approve",
          summary: editingSummary,
          audience: editingAudience,
          tone: editingTone,
          cta: editingCta,
          bannedTerms: editingBannedTerms,
        }
      );
      onProjectCreated(data.project);
    } catch (e) {
      onError(e instanceof Error ? e.message : "컨텍스트 승인에 실패했습니다.");
    } finally {
      setContextBusy(false);
    }
  }, [editingSummary, editingAudience, editingTone, editingCta, editingBannedTerms, onProjectCreated, onError]);

  const handleSaveContextDraft = useCallback(async (projectId: string) => {
    setContextBusy(true);
    onError("");
    try {
      const data = await apiPatch<{ project: ProjectDetail }>(
        `/api/projects/${projectId}/brand-profile`,
        {
          action: "draft",
          summary: editingSummary,
          audience: editingAudience,
          tone: editingTone,
          cta: editingCta,
          bannedTerms: editingBannedTerms,
        }
      );
      onProjectCreated(data.project);
    } catch (e) {
      onError(e instanceof Error ? e.message : "컨텍스트 저장에 실패했습니다.");
    } finally {
      setContextBusy(false);
    }
  }, [editingSummary, editingAudience, editingTone, editingCta, editingBannedTerms, onProjectCreated, onError]);

  return {
    name, setName,
    domain, setDomain,
    industry, setIndustry,
    workingPath, setWorkingPath,
    sourceFiles, setSourceFiles,
    busy, preview,
    editingSummary, setEditingSummary,
    editingAudience, setEditingAudience,
    editingTone, setEditingTone,
    editingCta, setEditingCta,
    editingBannedTerms, setEditingBannedTerms,
    contextBusy,
    handleCreateProject,
    hydrateContextForm,
    handleApproveContext,
    handleSaveContextDraft,
  };
}
