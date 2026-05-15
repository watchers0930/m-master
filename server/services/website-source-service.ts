import type { SourceFileInput } from "../validators/project-validator";

type WebsiteSnapshot = {
  title?: string;
  siteName?: string;
  description?: string;
  keywords: string[];
  headings: string[];
  keySections: string[];
  bodyExcerpt: string;
  fetchedUrl: string;
};

const UI_NOISE_WORDS = new Set([
  "star",
  "stars",
  "check",
  "arrow",
  "menu",
  "close",
  "prev",
  "next",
  "play",
  "pause",
  "home",
  "logo",
  "icon",
  "icons",
  "scroll",
  "more",
  "view",
  "learn",
  "read",
  "cookie",
  "privacy",
  "login",
  "sign",
  "search",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preprocessHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<dialog[\s\S]*?<\/dialog>/gi, " ")
    .replace(/<button[\s\S]*?<\/button>/gi, " ");
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWebsiteText(value: string) {
  const normalized = stripTags(value)
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/[|/\\><]+/g, " ")
    .replace(/[_-]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(/\s+/).filter((token) => {
    const lowered = token.toLowerCase();

    if (!lowered) {
      return false;
    }

    if (UI_NOISE_WORDS.has(lowered)) {
      return false;
    }

    if (/^[a-z]{1,4}$/.test(lowered) && !/[aeiou]/.test(lowered)) {
      return false;
    }

    if (/^[^a-z0-9가-힣]+$/i.test(lowered)) {
      return false;
    }

    return true;
  });

  return tokens.join(" ").trim();
}

function parseWebsiteTarget(target?: string) {
  if (!target) {
    return null;
  }

  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const normalizedPath = parsed.pathname.replace(/\/{2,}/g, "/");
    const pathname = normalizedPath === "/" ? "" : normalizedPath.replace(/\/+$/, "");

    return {
      original: target,
      hostname: parsed.hostname.toLowerCase(),
      pathname,
      protocol: parsed.protocol,
      href: `${parsed.origin}${pathname || "/"}`,
    };
  } catch {
    return null;
  }
}

function buildCandidateUrls(target?: string) {
  const parsed = parseWebsiteTarget(target);

  if (!parsed) {
    return [];
  }

  const withPath = parsed.pathname || "/";
  const urlSet = new Set<string>();

  if (/^https?:\/\//i.test(target || "")) {
    urlSet.add(parsed.href);
  } else {
    urlSet.add(`https://${parsed.hostname}${withPath}`);
    urlSet.add(`http://${parsed.hostname}${withPath}`);
  }

  if (parsed.pathname) {
    urlSet.add(`https://${parsed.hostname}/`);
  }

  return [...urlSet];
}

function matchTag(html: string, pattern: RegExp) {
  const matched = html.match(pattern);
  return matched?.[1] ? normalizeWebsiteText(matched[1]) : undefined;
}

function matchMetaContent(html: string, attributes: string[]) {
  for (const attribute of attributes) {
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapeRegExp(attribute)}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`,
      "i",
    );
    const matched = matchTag(html, pattern);
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

function extractHeadings(html: string) {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];

  return matches
    .map((match) => normalizeWebsiteText(match[1] || ""))
    .filter((heading) => heading.length >= 8)
    .slice(0, 8);
}

function extractKeySections(html: string) {
  const matches = [...html.matchAll(/<(main|article|section)[^>]*>([\s\S]*?)<\/\1>/gi)];
  const deduped = new Set<string>();

  for (const match of matches) {
    const cleaned = normalizeWebsiteText(match[2] || "");

    if (cleaned.length < 60) {
      continue;
    }

    if (deduped.has(cleaned)) {
      continue;
    }

    deduped.add(cleaned.slice(0, 220));

    if (deduped.size >= 4) {
      break;
    }
  }

  return [...deduped];
}

function extractMeaningfulBlocks(html: string) {
  const matches = [...html.matchAll(/<(p|li|h1|h2|h3|strong)[^>]*>([\s\S]*?)<\/\1>/gi)];
  const deduped = new Set<string>();

  for (const match of matches) {
    const cleaned = normalizeWebsiteText(match[2] || "");

    if (cleaned.length < 30) {
      continue;
    }

    if (deduped.has(cleaned)) {
      continue;
    }

    deduped.add(cleaned);

    if (deduped.size >= 12) {
      break;
    }
  }

  return [...deduped];
}

function extractKeywords(description?: string) {
  if (!description) {
    return [];
  }

  return description
    .split(/[|,·/]/)
    .map((entry) => normalizeWebsiteText(entry))
    .filter((entry) => entry.length >= 2)
    .slice(0, 5);
}

function buildWebsiteSnapshot(html: string, fetchedUrl: string): WebsiteSnapshot {
  const preprocessedHtml = preprocessHtml(html);
  const title = matchTag(preprocessedHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) || matchMetaContent(preprocessedHtml, ["og:title"]);
  const siteName = matchMetaContent(preprocessedHtml, ["og:site_name", "application-name"]);
  const description =
    matchMetaContent(preprocessedHtml, ["description", "og:description", "twitter:description"]) || undefined;
  const headings = extractHeadings(preprocessedHtml);
  const keySections = extractKeySections(preprocessedHtml);
  const meaningfulBlocks = extractMeaningfulBlocks(preprocessedHtml);
  const bodyExcerpt = meaningfulBlocks.join(" ").slice(0, 3200);

  return {
    title,
    siteName,
    description,
    keywords: extractKeywords(matchMetaContent(preprocessedHtml, ["keywords"])),
    headings,
    keySections,
    bodyExcerpt,
    fetchedUrl,
  };
}

function toExcerpt(snapshot: WebsiteSnapshot) {
  const parts = [
    snapshot.siteName ? `사이트명: ${snapshot.siteName}` : "",
    snapshot.title ? `페이지 제목: ${snapshot.title}` : "",
    snapshot.description ? `설명: ${snapshot.description}` : "",
    snapshot.keywords.length > 0 ? `메타 키워드: ${snapshot.keywords.join(", ")}` : "",
    snapshot.headings.length > 0 ? `주요 헤딩: ${snapshot.headings.join(" | ")}` : "",
    snapshot.keySections.length > 0 ? `핵심 섹션: ${snapshot.keySections.join(" || ")}` : "",
    snapshot.bodyExcerpt ? `본문 발췌: ${snapshot.bodyExcerpt}` : "",
  ].filter(Boolean);

  return parts.join("\n").slice(0, 4000);
}

function createSnapshotFileName(target?: string) {
  const parsed = parseWebsiteTarget(target);
  const base = parsed?.hostname || "website";
  const pathLabel = parsed?.pathname
    ? parsed.pathname.replace(/^\//, "").replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-+|-+$/g, "")
    : "homepage";

  return `${base}-${pathLabel || "page"}.html`;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; m-master-context-bot/1.0; +https://m-master.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();
    return {
      html,
      fetchedUrl: response.url || url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWebsiteSource(domain?: string): Promise<SourceFileInput | null> {
  const candidates = buildCandidateUrls(domain);

  for (const candidate of candidates) {
    try {
      const result = await fetchHtml(candidate);

      if (!result) {
        continue;
      }

      const snapshot = buildWebsiteSnapshot(result.html, result.fetchedUrl);
      const excerpt = toExcerpt(snapshot);

      if (!excerpt) {
        continue;
      }

      return {
        name: createSnapshotFileName(domain),
        relativePath: result.fetchedUrl,
        mimeType: "text/html",
        extension: "html",
        size: result.html.length,
        excerpt,
      };
    } catch {
      continue;
    }
  }

  return null;
}
