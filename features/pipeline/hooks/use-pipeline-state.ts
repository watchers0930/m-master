"use client";
import { useState, useCallback } from "react";
import type {
  ProjectListItem,
  ProjectDetail,
  StudioDetail,
  PipelineSectionLock,
  VariantGroup,
  MonthlyContentPlan,
  BulkOperationHistoryItem,
  AutomationReadinessReport,
  ChannelPublicationSummary,
} from "../types";
import { apiGet } from "./use-api";

export function usePipelineState() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [studio, setStudio] = useState<StudioDetail | null>(null);
  const [contentPlan, setContentPlan] = useState<MonthlyContentPlan | null>(null);
  const [publications, setPublications] = useState<ChannelPublicationSummary[]>([]);
  const [bulkOperationHistory, setBulkOperationHistory] = useState<BulkOperationHistoryItem[]>([]);
  const [automationReadiness, setAutomationReadiness] = useState<AutomationReadinessReport | null>(null);
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

  const loadProjects = useCallback(async () => {
    try {
      const data = await apiGet<{ projects: ProjectListItem[] }>("/api/projects");
      setProjects(data.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트 목록 로드 실패");
    }
  }, []);

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
      const message = e instanceof Error ? e.message : "스튜디오 로드 실패";
      if (message.includes("프로젝트 또는 컨텍스트 초안을 찾을 수 없습니다.")) {
        setStudio(null);
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContentPlan = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await apiGet<{ plan: MonthlyContentPlan | null }>(`/api/projects/${projectId}/content-plan`);
      setContentPlan(data.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "월간 계획 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPublications = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await apiGet<{ publications: ChannelPublicationSummary[] }>(`/api/projects/${projectId}/publications`);
      setPublications(data.publications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "게시 이력 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBulkOperationHistory = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await apiGet<{ runs: BulkOperationHistoryItem[] }>(`/api/projects/${projectId}/automation-batch-runs`);
      setBulkOperationHistory(data.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "대량 처리 이력 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAutomationReadiness = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await apiGet<{ readiness: AutomationReadinessReport }>(`/api/projects/${projectId}/automation-readiness`);
      setAutomationReadiness(data.readiness);
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동화 준비도 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadProject = useCallback(async (projectId: string) => {
    await Promise.all([
      loadProject(projectId),
      loadStudio(projectId),
      loadContentPlan(projectId),
      loadPublications(projectId),
      loadBulkOperationHistory(projectId),
      loadAutomationReadiness(projectId),
    ]);
  }, [loadProject, loadStudio, loadContentPlan, loadPublications, loadBulkOperationHistory, loadAutomationReadiness]);

  const clearError = useCallback(() => setError(""), []);

  return {
    projects,
    activeProject,
    studio,
    contentPlan,
    publications,
    bulkOperationHistory,
    automationReadiness,
    variantGroup,
    error,
    loading,
    sectionLock,
    setProjects,
    setActiveProject,
    setStudio,
    setContentPlan,
    setPublications,
    setBulkOperationHistory,
    setAutomationReadiness,
    setVariantGroup,
    setError,
    loadProjects,
    loadProject,
    loadStudio,
    loadContentPlan,
    loadPublications,
    loadBulkOperationHistory,
    loadAutomationReadiness,
    reloadProject,
    clearError,
  };
}
