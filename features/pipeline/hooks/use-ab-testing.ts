"use client";
import { useState, useCallback } from "react";
import type { VariantGroup, VariantSummary, StudioDetail } from "../types";
import { apiPost, apiPatch, apiGet } from "./use-api";

export function useAbTesting(params: {
  onVariantGroupUpdate: (group: VariantGroup | null) => void;
  onStudioUpdate: (studio: StudioDetail) => void;
  onError: (msg: string) => void;
}) {
  const { onVariantGroupUpdate, onStudioUpdate, onError } = params;
  const [generateBusy, setGenerateBusy] = useState(false);
  const [adoptBusy, setAdoptBusy] = useState<string | null>(null);

  const handleGenerateVariants = useCallback(async (projectId: string, topic: string, count: number = 2) => {
    setGenerateBusy(true);
    onError("");
    try {
      const data = await apiPost<{ variantGroup: VariantGroup }>(
        `/api/projects/${projectId}/content-jobs/variants`,
        { topic, count }
      );
      onVariantGroupUpdate(data.variantGroup);
    } catch (e) {
      onError(e instanceof Error ? e.message : "A/B 버전 생성에 실패했습니다.");
    } finally {
      setGenerateBusy(false);
    }
  }, [onVariantGroupUpdate, onError]);

  const handleAdoptVariant = useCallback(async (projectId: string, variantId: string) => {
    setAdoptBusy(variantId);
    onError("");
    try {
      const data = await apiPatch<{ studio: StudioDetail }>(
        `/api/projects/${projectId}/content-jobs/variants/${variantId}`,
        { adopted: true }
      );
      onStudioUpdate(data.studio);
      // Reload variant group
      try {
        const groupData = await apiGet<{ variantGroup: VariantGroup }>(
          `/api/projects/${projectId}/content-jobs/variants`
        );
        onVariantGroupUpdate(groupData.variantGroup);
      } catch {
        // Non-critical, variant group view will refresh on next load
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "버전 채택에 실패했습니다.");
    } finally {
      setAdoptBusy(null);
    }
  }, [onVariantGroupUpdate, onStudioUpdate, onError]);

  const loadVariantGroup = useCallback(async (projectId: string) => {
    try {
      const data = await apiGet<{ variantGroup: VariantGroup }>(
        `/api/projects/${projectId}/content-jobs/variants`
      );
      onVariantGroupUpdate(data.variantGroup);
    } catch {
      // No variants yet, that's fine
      onVariantGroupUpdate(null);
    }
  }, [onVariantGroupUpdate]);

  return {
    generateBusy,
    adoptBusy,
    handleGenerateVariants,
    handleAdoptVariant,
    loadVariantGroup,
  };
}
