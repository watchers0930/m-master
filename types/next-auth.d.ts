// types/next-auth.d.ts — 세션 사용자 필드 확장. adsEnabled = '광고' 메뉴 표시(서버 세션 콜백이 정함, lib/auth-session.ts). UX 전용.
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string; adsEnabled?: boolean } & DefaultSession['user'];
  }
}
