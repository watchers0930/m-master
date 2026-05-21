// lib/auth.ts — 인증 플레이스홀더
// marketing/app의 requireSession() 대체
// TODO: 실제 인증 구현 시 NextAuth 등으로 교체

export async function requireSession() {
  return { user: { id: 'default-owner' } };
}
