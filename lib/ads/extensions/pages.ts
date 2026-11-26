// lib/ads/extensions/pages.ts — 서브링크 후보·생존 확인(광고 사이트 = 비즈채널 랜딩 호스트만 부른다).
// - sitePages: https://<랜딩 호스트>/sitemap.xml의 <loc> 중 같은 호스트 https 주소(최대 MAX_PAGES) + 앞쪽 MAX_TITLED개의 <title>.
//   사이트맵 목록(sitemapindex)이면 하위 사이트맵 최대 3개를 한 단계만 따라간다. 없거나 읽지 못하면 빈 목록(대장이 주소를 직접 넣을 수 있다).
//   리다이렉트도 같은 호스트·기본 포트(443)만 따라간다. 본문을 읽다 끊긴 페이지는 제목 없음으로 넘어간다.
// - deadLinks: 각 주소를 GET(리다이렉트는 같은 호스트 안에서 최대 3번)해 최종 200이 아니면 죽은 링크. 등록 직전에 부른다.
// 요청 대상은 늘 랜딩 호스트로 제한된다(입력 주소는 rules.ts가 같은 호스트만 통과시킨다 — 다른 호스트로 리다이렉트되면 죽은 링크).
export type SitePage = { url: string; title: string | null };
type Fetch = typeof fetch;

export const MAX_PAGES = 30;
const MAX_TITLED = 12;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const MAX_CHILD_SITEMAPS = 3;

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= max) { await reader.cancel(); break; }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

/** 같은 호스트 안에서만 리다이렉트를 따라간다. 최종 응답(다른 호스트·횟수 초과·네트워크 오류면 null). */
async function getSameHost(url: string, host: string, fetchImpl: Fetch): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "MINTEQ-link-check/1.0" } });
    } catch {
      return null;
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => {}); // 리다이렉트 본문 오류가 전체를 깨지 않게(codex MED 2차)
    let next: URL;
    try { next = new URL(location, current); } catch { return null; }
    if (next.protocol !== "https:" || next.hostname.toLowerCase() !== host || (next.port && next.port !== "443") || next.username || next.password) return null;
    current = next.toString();
  }
  return null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** 200 응답 본문(상한까지). 본문을 읽다 끊기면(타임아웃 등) null — 한 페이지 오류가 초안 전체를 깨지 않게(codex MED). */
async function getText(url: string, host: string, fetchImpl: Fetch, max: number): Promise<string | null> {
  const res = await getSameHost(url, host, fetchImpl);
  if (!res || res.status !== 200) { await res?.body?.cancel().catch(() => {}); return null; }
  try {
    return await readCapped(res, max);
  } catch {
    return null;
  }
}

async function titleOf(url: string, host: string, fetchImpl: Fetch): Promise<string | null> {
  const html = await getText(url, host, fetchImpl, 64_000);
  const m = html ? /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html) : null;
  return m ? decode(m[1]).replace(/\s+/g, " ").trim() || null : null;
}

/** <loc> 중 같은 호스트·기본 포트 https 주소. */
function locsOf(xml: string, host: string): URL[] {
  const out: URL[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    let u: URL;
    try { u = new URL(decode(m[1])); } catch { continue; }
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== host || u.username || u.password || (u.port && u.port !== "443")) continue;
    out.push(u);
  }
  return out;
}

export async function sitePages(host: string, fetchImpl: Fetch = fetch): Promise<SitePage[]> {
  const root = await getText(`https://${host}/sitemap.xml`, host, fetchImpl, MAX_BYTES);
  if (!root) return [];
  // 사이트맵 목록(sitemapindex)이면 하위 사이트맵을 앞에서부터 MAX_CHILD_SITEMAPS개까지 한 단계만 따라간다(더 깊이는 안 감).
  const xmls = /<sitemapindex[\s>]/i.test(root)
    ? (await Promise.all(locsOf(root, host).slice(0, MAX_CHILD_SITEMAPS).map((u) => getText(u.toString(), host, fetchImpl, MAX_BYTES)))).filter((x): x is string => !!x)
    : [root];
  const urls: string[] = [];
  for (const xml of xmls) for (const u of locsOf(xml, host)) {
    if (/\.xml(\.gz)?$/i.test(u.pathname)) continue; // 사이트맵 파일은 페이지가 아니다
    const s = u.toString();
    if (!urls.includes(s) && urls.length < MAX_PAGES) urls.push(s);
  }
  const titles = await Promise.all(urls.slice(0, MAX_TITLED).map((u) => titleOf(u, host, fetchImpl)));
  return urls.map((url, i) => ({ url, title: titles[i] ?? null }));
}

/** 최종 200이 아닌 주소 목록(입력 순서). */
export async function deadLinks(urls: readonly string[], host: string, fetchImpl: Fetch = fetch): Promise<string[]> {
  const ok = await Promise.all(urls.map(async (u) => {
    const res = await getSameHost(u, host, fetchImpl);
    await res?.body?.cancel().catch(() => {});
    return res?.status === 200;
  }));
  return urls.filter((_, i) => !ok[i]);
}
