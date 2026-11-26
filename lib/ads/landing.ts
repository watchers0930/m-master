// lib/ads/landing.ts — 선택한 비즈채널(사이트)의 랜딩 URL = channelKey. 소재 최종 URL(apply-steps.ts)·확장소재 서브링크 호스트(extensions)가 같이 쓴다.
// ⚠️ 스킴 없는 값이면 https://를 붙인다(실측 전 가정). 형태가 다르면 unexpectedNaverResponse.
import type { NaverAdsClient } from "@/lib/external/naver-searchad";
import { naverChannelSchema } from "@/schemas/ads";
import { unexpectedNaverResponse } from "./http";

export async function readLandingUrl(client: Pick<NaverAdsClient, "get">, businessChannelId: string): Promise<string> {
  const parsed = naverChannelSchema.safeParse(await client.get(`/ncc/channels/${businessChannelId}`));
  if (!parsed.success || !parsed.data.channelKey) throw unexpectedNaverResponse();
  const raw = parsed.data.channelKey.trim();
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}
