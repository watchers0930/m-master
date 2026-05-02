import type { SourceFileInput } from "../validators/project-validator";

type WebsiteSnapshot = {
  title?: string;
  description?: string;
  headings: string[];
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
]);

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
    .replace(/<button[\s\S]*?<\/button>/gi, " ");
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
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

function matchTag(html: string, pattern: RegExp) {
  const matched = html.match(pattern);
  return matched?.[1] ? normalizeWebsiteText(matched[1]) : undefined;
}

function extractHeadings(html: string) {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];

  return matches
    .map((match) => normalizeWebsiteText(match[1] || ""))
    .filter((heading) => heading.length >= 8)
    .slice(0, 6);
}

function extractMeaningfulBlocks(html: string) {
  const matches = [...html.matchAll(/<(p|li|h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)];
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

    if (deduped.size >= 8) {
      break;
    }
  }

  return [...deduped];
}

function buildWebsiteSnapshot(html: string, fetchedUrl: string): WebsiteSnapshot {
  const preprocessedHtml = preprocessHtml(html);
  const title = matchTag(preprocessedHtml, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = matchTag(
    preprocessedHtml,
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  const ogDescription = matchTag(
    preprocessedHtml,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  const headings = extractHeadings(preprocessedHtml);
  const bodyExcerpt = extractMeaningfulBlocks(preprocessedHtml).join(" ").slice(0, 2400);

  return {
    title,
    description: description || ogDescription,
    headings,
    bodyExcerpt,
    fetchedUrl,
  };
}

function toExcerpt(snapshot: WebsiteSnapshot) {
  const parts = [
    snapshot.title ? `페이지 제목: ${snapshot.title}` : "",
    snapshot.description ? `설명: ${snapshot.description}` : "",
    snapshot.headings.length > 0 ? `주요 섹션: ${snapshot.headings.join(" | ")}` : "",
    snapshot.bodyExcerpt ? `본문 발췌: ${snapshot.bodyExcerpt}` : "",
  ].filter(Boolean);

  return parts.join("\n").slice(0, 4000);
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; m-master-context-bot/1.0; +https://tm-master.vercel.app)",
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
  if (!domain) {
    return null;
  }

  const candidates = [`https://${domain}`, `http://${domain}`];

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
        name: `${domain}-homepage.html`,
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
