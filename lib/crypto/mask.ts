// lib/crypto/mask.ts — 화면 표시용 비밀값 마스킹(순수 함수, 클라이언트 번들에서도 사용 — node:crypto 의존 없음)
const MASK = "••••";
const MASK_MIN_LENGTH = 8;

// 8자 이하는 마스크만, 그보다 길면 뒤 4자리만 보인다(코드포인트 기준).
export function maskSecret(plain: string): string {
  const chars = Array.from(plain);
  if (chars.length <= MASK_MIN_LENGTH) return MASK;
  return MASK + chars.slice(-4).join("");
}
