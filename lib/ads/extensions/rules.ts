// lib/ads/extensions/rules.ts — 확장소재 등록 기준 린터 + 네이버 본문 변환. 순수 함수(I/O 없음).
// 기준(✅ 네이버 공식 안내·실측 2026-11-26, 근거는 lint-rules.ts):
//   추가제목(HEADLINE) 1~15자 · 홍보문구(DESCRIPTION) 1~14자 · 서브링크(SUB_LINKS) 3~4개, 링크 이름 1~6자, https, 광고 사이트(랜딩)와 같은 호스트.
//   문자 종류·최상급 표현은 소재와 같은 엔진(lint.ts lintExtensionText) — 확장소재는 '·'도 막는다(실측 pattern 위반).
// 빈 문자열·빈 배열은 '그 종류는 만들지 않음'이다(위반 아님).
import type { ExtensionType } from "@/schemas/ads-extension";
import { lintExtensionText } from "../lint";

export type SubLinkDraft = { name: string; url: string };
export type ExtensionDraft = { headline?: string; promo?: string; subLinks?: SubLinkDraft[] };
export type ExtensionTarget = "headline" | "promo" | "subLinks";
export type ExtensionIssue = { target: ExtensionTarget; index: number | null; rule: string; message: string };
export type ExtensionBody = { type: ExtensionType; adExtension: unknown };

export const SUB_LINKS_MIN = 3;
export const SUB_LINKS_MAX = 4;

const text = (v: string | undefined) => (v ?? "").normalize("NFC").trim();

/** 랜딩 URL의 호스트(소문자). 서브링크는 이 호스트와 같아야 한다. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function urlIssue(raw: string, host: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "주소 형식이 아닙니다.";
  }
  if (u.protocol !== "https:") return "https:// 주소만 쓸 수 있습니다.";
  if (u.username || u.password) return "계정 정보가 든 주소는 쓸 수 없습니다.";
  if (u.port && u.port !== "443") return "기본 포트(443) 주소만 쓸 수 있습니다.";
  if (u.hostname.toLowerCase() !== host) return `광고 사이트(${host}) 안의 페이지만 연결할 수 있습니다.`;
  return null;
}

export function lintExtensions(d: ExtensionDraft, landingHost: string): ExtensionIssue[] {
  const out: ExtensionIssue[] = [];
  const push = (target: ExtensionTarget, index: number | null, rule: string, message: string) => out.push({ target, index, rule, message });
  if (text(d.headline)) for (const i of lintExtensionText(text(d.headline), "extHeadline")) push("headline", null, i.rule, i.message);
  if (text(d.promo)) for (const i of lintExtensionText(text(d.promo), "promo")) push("promo", null, i.rule, i.message);
  const links = d.subLinks ?? [];
  if (links.length === 0) return out;
  if (links.length < SUB_LINKS_MIN || links.length > SUB_LINKS_MAX)
    push("subLinks", null, "sub-links-count", `서브링크는 ${SUB_LINKS_MIN}~${SUB_LINKS_MAX}개여야 합니다(현재 ${links.length}개).`);
  const names = new Set<string>(), urls = new Set<string>();
  links.forEach((l, i) => {
    const name = text(l.name);
    for (const x of lintExtensionText(name, "linkName")) push("subLinks", i, x.rule, x.message);
    const bad = urlIssue(l.url, landingHost);
    if (bad) push("subLinks", i, "sub-link-url", bad);
    if (names.has(name)) push("subLinks", i, "sub-link-duplicate", "같은 링크 이름이 이미 있습니다.");
    const key = l.url.trim().replace(/\/+$/, "").toLowerCase();
    if (urls.has(key)) push("subLinks", i, "sub-link-duplicate", "같은 주소가 이미 있습니다.");
    names.add(name);
    urls.add(key);
  });
  return out;
}

/** 네이버 adExtension 본문(실측 형태). 린트를 통과한 값만 넘긴다. 순서 = 등록 순서. */
export function toNaverBodies(d: ExtensionDraft): ExtensionBody[] {
  const out: ExtensionBody[] = [];
  if (text(d.headline)) out.push({ type: "HEADLINE", adExtension: { headline: text(d.headline) } });
  if (text(d.promo)) out.push({ type: "DESCRIPTION", adExtension: { description: text(d.promo) } });
  if (d.subLinks?.length) out.push({ type: "SUB_LINKS", adExtension: d.subLinks.map((l) => ({ name: text(l.name), final: l.url.trim() })) });
  return out;
}

/** 네이버가 돌려준 adExtension과 보낸 본문이 같은가(재전송 없이 대조할 때). 이름·주소만 비교한다. */
export function sameContent(type: ExtensionType, a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string | null => {
    if (type === "SUB_LINKS") {
      if (!Array.isArray(v)) return null;
      return JSON.stringify(v.map((x) => [text((x as { name?: string })?.name), String((x as { final?: string })?.final ?? "").trim()]));
    }
    const field = type === "HEADLINE" ? "headline" : "description";
    const s = v && typeof v === "object" ? (v as Record<string, unknown>)[field] : undefined;
    return typeof s === "string" ? text(s) : null;
  };
  const x = norm(a);
  return x !== null && x === norm(b);
}
