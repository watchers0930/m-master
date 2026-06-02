// 채널 연동 — 서버 컴포넌트 (초기 데이터 조회 후 ChannelForm에 전달)
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import ChannelForm from './ChannelForm';

function mask(v: string): string {
  if (v.length < 6) return '***';
  return v.slice(0, 4) + '****' + v.slice(-3);
}

export default async function ChannelsPage() {
  const creds = await prisma.channelCredential.findMany();

  const initial: Record<string, { connected: boolean; masked: Record<string, string> }> = {};

  for (const c of creds) {
    const meta = (c.meta ?? {}) as Record<string, string>;
    const masked: Record<string, string> = {};
    if (c.accessToken) masked.accessToken = mask(c.accessToken);
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === 'string' && v.length > 0) masked[k] = mask(v);
    }
    initial[c.channel] = { connected: true, masked };
  }

  // 환경변수 기반 연결 상태도 확인 (DB에 없지만 env로 설정된 경우)
  if (!initial.naver_cafe) {
    const hasEnv = !!(process.env.NAVER_CAFE_ACCESS_TOKEN && process.env.NAVER_CAFE_CLUB_ID && process.env.NAVER_CAFE_MENU_ID);
    if (hasEnv) {
      initial.naver_cafe = {
        connected: true,
        masked: {
          accessToken: mask(process.env.NAVER_CAFE_ACCESS_TOKEN!),
          clubId: mask(process.env.NAVER_CAFE_CLUB_ID!),
          menuId: mask(process.env.NAVER_CAFE_MENU_ID!),
        },
      };
    }
  }

  if (!initial.instagram) {
    const hasEnv = !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ID);
    if (hasEnv) {
      initial.instagram = {
        connected: true,
        masked: {
          accessToken: mask(process.env.INSTAGRAM_ACCESS_TOKEN!),
          businessId: mask(process.env.INSTAGRAM_BUSINESS_ID!),
        },
      };
    }
  }

  if (!initial.facebook) {
    const hasEnv = !!(process.env.FACEBOOK_ACCESS_TOKEN && process.env.FACEBOOK_PAGE_ID);
    if (hasEnv) {
      initial.facebook = {
        connected: true,
        masked: {
          accessToken: mask(process.env.FACEBOOK_ACCESS_TOKEN!),
          pageId: mask(process.env.FACEBOOK_PAGE_ID!),
        },
      };
    }
  }

  const cafeTargets = await prisma.cafeTarget.findMany({ orderBy: { createdAt: 'asc' } });

  return <ChannelForm initial={initial} cafeTargets={cafeTargets.map(t => ({
    id: t.id, name: t.name, clubId: t.clubId, menuId: t.menuId, isDefault: t.isDefault,
  }))} />;
}
