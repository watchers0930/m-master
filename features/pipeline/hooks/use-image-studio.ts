"use client";

import { useState, useCallback } from "react";
import { apiPost, apiPatch } from "./use-api";
import type { ChannelKey, ImageStudioState, StudioDetail } from "../types";

type Options = {
  onStudioUpdate: (studio: StudioDetail) => void;
  onError: (msg: string) => void;
};

export function useImageStudio({ onStudioUpdate, onError }: Options) {
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("blog");
  const [generateBusy, setGenerateBusy] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [imageStudios, setImageStudios] = useState<Record<ChannelKey, ImageStudioState | null>>({
    blog: null,
    instagram: null,
    facebook: null,
  });

  const hydrateFromStudio = useCallback((studio: StudioDetail) => {
    const record: Record<ChannelKey, ImageStudioState | null> = { blog: null, instagram: null, facebook: null };
    for (const img of studio.draft?.images ?? []) {
      record[img.channel] = img;
    }
    setImageStudios(record);
  }, []);

  const handleGenerateImages = useCallback(async (projectId: string, channel: ChannelKey, prompt?: string) => {
    setGenerateBusy(true);
    try {
      const res = await apiPost<{ studio: StudioDetail }>(`/api/projects/${projectId}/images`, { channel, prompt });
      onStudioUpdate(res.studio);
      hydrateFromStudio(res.studio);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "이미지 생성 실패");
    } finally {
      setGenerateBusy(false);
    }
  }, [onStudioUpdate, onError, hydrateFromStudio]);

  const handleSelectImage = useCallback(async (projectId: string, channel: ChannelKey, imageAssetId: string) => {
    setSelectBusy(true);
    try {
      const res = await apiPatch<{ studio: StudioDetail }>(`/api/projects/${projectId}/images`, { channel, imageAssetId });
      onStudioUpdate(res.studio);
      hydrateFromStudio(res.studio);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "이미지 선택 실패");
    } finally {
      setSelectBusy(false);
    }
  }, [onStudioUpdate, onError, hydrateFromStudio]);

  const currentStudio = imageStudios[activeChannel];

  return {
    activeChannel,
    setActiveChannel,
    generateBusy,
    selectBusy,
    imageStudios,
    currentStudio,
    hydrateFromStudio,
    handleGenerateImages,
    handleSelectImage,
  };
}
