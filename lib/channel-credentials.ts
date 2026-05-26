// lib/channel-credentials.ts — 채널 자격증명 DB 조회 + 환경변수 fallback
// publish 함수들이 이 헬퍼를 통해 자격증명을 가져온다.

import { prisma } from './prisma';

export interface NaverCafeCreds {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  clubId: string;
  menuId: string;
}

export interface InstagramCreds {
  accessToken: string;
  businessId: string;
}

export interface FacebookCreds {
  accessToken: string;
  pageId: string;
}

/** 네이버 카페 자격증명: DB 우선 → 환경변수 fallback */
export async function getNaverCafeCreds(): Promise<NaverCafeCreds | null> {
  const row = await prisma.channelCredential.findUnique({ where: { channel: 'naver_cafe' } });
  if (row?.accessToken) {
    const m = (row.meta ?? {}) as Record<string, string>;
    return {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken ?? '',
      clientId: m.clientId ?? '',
      clientSecret: m.clientSecret ?? '',
      clubId: m.clubId ?? '',
      menuId: m.menuId ?? '',
    };
  }
  const at = process.env.NAVER_CAFE_ACCESS_TOKEN;
  const club = process.env.NAVER_CAFE_CLUB_ID;
  const menu = process.env.NAVER_CAFE_MENU_ID;
  if (!at || !club || !menu) return null;
  return {
    accessToken: at,
    refreshToken: process.env.NAVER_CAFE_REFRESH_TOKEN ?? '',
    clientId: process.env.NAVER_CLIENT_ID ?? '',
    clientSecret: process.env.NAVER_CLIENT_SECRET ?? '',
    clubId: club,
    menuId: menu,
  };
}

/** 인스타그램 자격증명: DB 우선 → 환경변수 fallback */
export async function getInstagramCreds(): Promise<InstagramCreds | null> {
  const row = await prisma.channelCredential.findUnique({ where: { channel: 'instagram' } });
  if (row?.accessToken) {
    const m = (row.meta ?? {}) as Record<string, string>;
    return { accessToken: row.accessToken, businessId: m.businessId ?? '' };
  }
  const at = process.env.INSTAGRAM_ACCESS_TOKEN;
  const bid = process.env.INSTAGRAM_BUSINESS_ID;
  if (!at || !bid) return null;
  return { accessToken: at, businessId: bid };
}

/** 페이스북 자격증명: DB 우선 → 환경변수 fallback */
export async function getFacebookCreds(): Promise<FacebookCreds | null> {
  const row = await prisma.channelCredential.findUnique({ where: { channel: 'facebook' } });
  if (row?.accessToken) {
    const m = (row.meta ?? {}) as Record<string, string>;
    return { accessToken: row.accessToken, pageId: m.pageId ?? '' };
  }
  const at = process.env.FACEBOOK_ACCESS_TOKEN;
  const pid = process.env.FACEBOOK_PAGE_ID;
  if (!at || !pid) return null;
  return { accessToken: at, pageId: pid };
}
