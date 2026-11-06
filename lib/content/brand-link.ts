// lib/content/brand-link.ts — 블로그 글의 자사 사이트 링크 보정 (자동·수동·A/B 생성 경로 공용, 저장 직전 적용)
// 모델이 주소 대신 "(자사 링크로 연결)" 같은 자리표시를 쓰거나 링크를 빠뜨리면(2026-11-06 운영 자동 글) 서버가 실제 주소로 맞춘다.
// 네이버 발행기는 본문을 그대로 타이핑하므로 마크다운 링크가 아니라 주소만 한 줄로 넣는다.
// 카페·SNS 는 건드리지 않는다(카페는 홍보 링크가 삭제·제재 대상, SNS 는 본문 링크가 동작하지 않음).

// 자리표시만 지운다: 링크/바로가기/URL/주소 를 가리키는 짧은 괄호 문구. "(사이트맵 제출 필요)" 같은 설명은 남긴다.
const PLACEHOLDER = /[ \t]*[([]\s*(?:자사|공식|브랜드)?\s*(?:홈페이지|사이트|웹사이트)?\s*(?:링크|바로가기|URL|주소)(?:\s*(?:로|으로)?\s*(?:연결|이동|삽입|첨부|넣기))?\s*[)\]](?!\()/gi; // "[사이트 링크](url)" 마크다운 링크 라벨은 제외
const TAGS = /\n(?:-{3,}[ \t]*\n+)?\*{0,2}태그\s*:?/;
const URLS = /https?:\/\/[^\s<>"'`)\]*]+/gi; // 강조 ** 와 괄호에서 끊고, 끝 문장부호는 아래에서 뗀다

/** 설정의 website_url 을 서버에서 검증: http(s)·도메인 있음·발행기 서식 문자(* 등) 없는 주소만 쓴다. */
export function brandSiteUrl(brandGuide: Record<string, unknown>): string | null {
  const raw = brandGuide.website_url;
  if (typeof raw !== 'string' || /[\s*<>"'`]/.test(raw.trim())) return null;
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href;
  } catch {
    return null;
  }
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');
/** 본문의 실제 URL 중 hostname 이 자사 도메인과 같은 것이 있는가 (문자열 포함이 아니라 hostname 비교). */
function hasSiteLink(text: string, site: string) {
  const host = bareHost(new URL(site).hostname);
  return (text.match(URLS) ?? []).some(u => { try { return bareHost(new URL(u.replace(/[.,!?;:]+$/, '')).hostname) === host; } catch { return false; } });
}

export function ensureBrandLink(text: string, brandGuide: Record<string, unknown>, channel: string): string {
  if (channel !== 'blog') return text;
  const placeholderAt = text.search(PLACEHOLDER);
  let out = text.replace(PLACEHOLDER, '');
  const url = brandSiteUrl(brandGuide);
  if (!url || hasSiteLink(out, url)) return out;
  // 위치: 마지막 CTA 문구 줄 끝 → 자리표시가 있던 줄 끝 → 태그 블록 앞 → 본문 끝
  const cta = typeof brandGuide.cta_message === 'string' ? brandGuide.cta_message.trim() : '';
  const tagsAt = out.search(TAGS);
  const ctaAt = cta ? out.lastIndexOf(cta, tagsAt >= 0 ? tagsAt : out.length) : -1; // 태그 블록 안의 같은 문구는 제외
  const anchor = ctaAt >= 0 ? ctaAt + cta.length : placeholderAt >= 0 ? Math.min(placeholderAt, out.length) : -1;
  if (anchor >= 0) {
    const lineEnd = out.indexOf('\n', anchor);
    const at = lineEnd < 0 ? out.length : lineEnd;
    return `${out.slice(0, at)}\n\n${url}${out.slice(at)}`;
  }
  if (tagsAt >= 0) return `${out.slice(0, tagsAt)}\n\n${url}\n${out.slice(tagsAt)}`;
  out = out.trimEnd();
  return `${out}\n\n${url}`;
}
