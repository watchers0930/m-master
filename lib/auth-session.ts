// lib/auth-session.ts — NextAuth 세션 콜백(lib/auth.ts가 쓴다). 순수 함수라 단위 테스트한다(lib/ads/__tests__/session-flag.test.cjs).
// - session.user.id = token.id(로그인 때 jwt 콜백이 넣은 사용자 id), 없으면 token.sub(NextAuth 기본 사용자 id).
// - session.user.adsEnabled = isAdsOwner(id): '광고' 메뉴 표시용(Task 12 판정 — layout이 auth()를 부르지 않게 서버에서 여기서 정한다).
//   UX 전용이다. API는 여전히 assertAdsOwner(허용목록)로 404를 낸다. env 없음·빈 값이면 false(fail-closed).
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { isAdsOwner } from '@/lib/ads/access';

export function sessionCallback({ session, token }: { session: Session; token: JWT }): Session {
  const id = typeof token.id === 'string' && token.id ? token.id : typeof token.sub === 'string' ? token.sub : undefined;
  if (session.user) {
    if (id) session.user.id = id;
    session.user.adsEnabled = isAdsOwner(id);
  }
  return session;
}
