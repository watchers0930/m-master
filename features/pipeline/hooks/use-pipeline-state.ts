"use client";
import { useState, useCallback } from "react";
import type {
  ProjectDetail,
  StudioDetail,
  PipelineSectionLock,
  VariantGroup,
} from "../types";
import { apiGet } from "./use-api";

export function usePipelineState() {
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [studio, setStudio] = useState<StudioDetail | null>(null);
  const [variantGroup, setVariantGroup] = useState<VariantGroup | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Section lock logic
  const sectionLock: PipelineSectionLock = {
    source: false, // always open
    generation: !activeProject?.brandProfile?.approved,
    ab: !studio?.draft?.assets?.length,
    verify: !studio?.draft?.assets?.length && !variantGroup?.variants?.some(v => v.adopted),
  };

  const loadProject = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await apiGet<{ project: ProjectDetail }>(`/api/projects/${projectId}`);
      setActiveProject(data.project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStudio = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await apiGet<{ studio: StudioDetail }>(`/api/projects/${projectId}/studio`);
      setStudio(data.studio);
    } catch (e) {
      setError(e instanceof Error ? e.message : "스튜디오 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadProject = useCallback(async (projectId: string) => {
    await Promise.all([loadProject(projectId), loadStudio(projectId)]);
  }, [loadProject, loadStudio]);

  const clearError = useCallback(() => setError(""), []);

  return {
    activeProject,
    studio,
    variantGroup,
    error,
    loading,
    sectionLock,
    setActiveProject,
    setStudio,
    setVariantGroup,
    setError,
    loadProject,
    loadStudio,
    reloadProject,
    clearError,
  };
}
