// lib/channel-credentials.ts — 채널 자격증명 DB 조회 + 환경변수 fallback
// publish 함수들이 이 헬퍼를 통해 자격증명을 가져온다.

import { prisma } from './prisma';
import { readChannelCredential } from './credentials/store';

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

/**
 * 플랫폼 오너(첫 가입 유저) 여부 확인
 * env fallback은 플랫폼 오너에게만 적용 — SaaS 유저 간 credential 격리
 * 프로세스 수명 동안 캐시 (첫 유저 ID는 변하지 않음)
 */
let _platformOwnerId: string | null | undefined; // undefined=미조회, null=유저없음

export async function isPlatformOwner(ownerId: string): Promise<boolean> {
  if (_platformOwnerId === undefined) {
    const first = await prisma.user.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    _platformOwnerId = first?.id ?? null;
  }
  return _platformOwnerId === ownerId;
}

// 복호화 실패(CredentialCryptoError)는 여기서 잡지 않고 그대로 throw한다. 발행 어댑터의 resolveCredentials가
// lib/publish/errors.ts loadCredentials로 ChannelRejection(확정 실패 — 전송 없음)으로 번역한다.

/** 네이버 카페 자격증명: DB 우선 → 플랫폼 오너만 env fallback */
export async function getNaverCafeCreds(ownerId: string): Promise<NaverCafeCreds | null> {
  const row = await readChannelCredential(ownerId, 'naver_cafe');
  if (row?.accessToken) {
    const m = row.meta;
    return {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken ?? '',
      clientId: m.clientId ?? '',
      clientSecret: m.clientSecret ?? '',
      clubId: m.clubId ?? '',
      menuId: m.menuId ?? '',
    };
  }
  // SaaS: env fallback은 플랫폼 오너(첫 유저)에게만 허용
  if (!(await isPlatformOwner(ownerId))) return null;
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

/** 인스타그램 자격증명: DB 우선 → 플랫폼 오너만 env fallback */
export async function getInstagramCreds(ownerId: string): Promise<InstagramCreds | null> {
  const row = await readChannelCredential(ownerId, 'instagram');
  if (row?.accessToken) {
    const m = row.meta;
    return { accessToken: row.accessToken, businessId: m.businessId ?? '' };
  }
  if (!(await isPlatformOwner(ownerId))) return null;
  const at = process.env.INSTAGRAM_ACCESS_TOKEN;
  const bid = process.env.INSTAGRAM_BUSINESS_ID;
  if (!at || !bid) return null;
  return { accessToken: at, businessId: bid };
}

/** 카페 타겟 목록 조회 — 본인(ownerId) 것만. ownerId 없이 전체를 읽는 경로는 두지 않는다(테넌트 격리). */
export async function getCafeTargets(ownerId: string) {
  if (typeof ownerId !== 'string' || ownerId.length === 0) throw new Error('getCafeTargets: ownerId required');
  return prisma.cafeTarget.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
}

/** 카페 타겟 단건 조회 */
export async function getCafeTargetById(id: string) {
  return prisma.cafeTarget.findUnique({ where: { id } });
}

/** 페이스북 자격증명: DB 우선 → 플랫폼 오너만 env fallback */
export async function getFacebookCreds(ownerId: string): Promise<FacebookCreds | null> {
  const row = await readChannelCredential(ownerId, 'facebook');
  if (row?.accessToken) {
    const m = row.meta;
    return { accessToken: row.accessToken, pageId: m.pageId ?? '' };
  }
  if (!(await isPlatformOwner(ownerId))) return null;
  const at = process.env.FACEBOOK_ACCESS_TOKEN;
  const pid = process.env.FACEBOOK_PAGE_ID;
  if (!at || !pid) return null;
  return { accessToken: at, pageId: pid };
}
