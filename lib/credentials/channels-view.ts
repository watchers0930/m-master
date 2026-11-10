// lib/credentials/channels-view.ts — 채널 연동 화면 초기 상태(세션 소유자 범위)
// - DB 행: 본인(ownerId) 것만, 복호화 후 마스킹
// - env 기반 "연결됨" 표시: 플랫폼 오너에게만(발행 경로의 env fallback 규칙과 동일 — isPlatformOwner)
// - 카페 타겟: 본인 것만

import { getCafeTargets, isPlatformOwner } from '@/lib/channel-credentials';
import { maskSecret } from '@/lib/crypto/credentials';
import { listMaskedCredentials, type MaskedCredentials } from './store';

const ENV_CHANNELS: { channel: string; vars: Record<string, string> }[] = [
  { channel: 'naver_cafe', vars: { accessToken: 'NAVER_CAFE_ACCESS_TOKEN', clubId: 'NAVER_CAFE_CLUB_ID', menuId: 'NAVER_CAFE_MENU_ID' } },
  { channel: 'instagram', vars: { accessToken: 'INSTAGRAM_ACCESS_TOKEN', businessId: 'INSTAGRAM_BUSINESS_ID' } },
  { channel: 'facebook', vars: { accessToken: 'FACEBOOK_ACCESS_TOKEN', pageId: 'FACEBOOK_PAGE_ID' } },
];

export interface ChannelsInitialState {
  initial: MaskedCredentials;
  cafeTargets: { id: string; name: string; clubId: string; menuId: string; isDefault: boolean }[];
}

export async function channelsInitialState(ownerId: string): Promise<ChannelsInitialState> {
  const [initial, owner, targets] = await Promise.all([
    listMaskedCredentials(ownerId),
    isPlatformOwner(ownerId),
    getCafeTargets(ownerId),
  ]);
  if (owner) {
    for (const { channel, vars } of ENV_CHANNELS) {
      if (initial[channel]) continue;
      const values = Object.entries(vars).map(([field, name]) => [field, process.env[name]] as const);
      if (values.some(([, v]) => !v)) continue;
      initial[channel] = { connected: true, masked: Object.fromEntries(values.map(([f, v]) => [f, maskSecret(v!)])) };
    }
  }
  return {
    initial,
    cafeTargets: targets.map(t => ({ id: t.id, name: t.name, clubId: t.clubId, menuId: t.menuId, isDefault: t.isDefault })),
  };
}
