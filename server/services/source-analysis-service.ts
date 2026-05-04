import type { SourceFileInput } from "../validators/project-validator";

export type SourceAnalysis = {
  totalFiles: number;
  filesWithExcerpt: number;
  fileTypeBreakdown: Array<{
    key: string;
    count: number;
  }>;
  topSourceFiles: Array<{
    name: string;
    relativePath?: string;
    excerptLength: number;
  }>;
  keywordHints: string[];
  excerptDigest: string;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "into",
  "about",
  "your",
  "있습니다",
  "합니다",
  "통해",
  "대한",
  "위한",
  "기반",
  "에서",
  "으로",
  "하는",
  "하고",
  "및",
  "까지",
  "또는",
  "보다",
  "api",
  "admin",
  "docs",
  "json",
  "html",
  "http",
  "https",
  "www",
  "txt",
  "md",
  "ts",
]);

function isUsefulKeyword(token: string) {
  if (STOP_WORDS.has(token)) {
    return false;
  }

  if (/^\d+$/.test(token)) {
    return false;
  }

  if (/^[a-z]{1,3}$/.test(token)) {
    return false;
  }

  if (/(.)\1{2,}/.test(token)) {
    return false;
  }

  return token.length >= 2;
}

function detectFileKey(file: SourceFileInput): string {
  if (file.extension) {
    return file.extension.replace(/^\./, "").toLowerCase();
  }

  if (file.mimeType) {
    return file.mimeType.toLowerCase();
  }

  const matched = file.name.match(/\.([a-zA-Z0-9]+)$/);
  return matched?.[1]?.toLowerCase() ?? "unknown";
}

function collectKeywordHints(files: SourceFileInput[]): string[] {
  const scores = new Map<string, number>();

  for (const file of files) {
    if (!file.excerpt) {
      continue;
    }

    const tokens = file.excerpt
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(isUsefulKeyword);

    for (const token of tokens) {
      scores.set(token, (scores.get(token) ?? 0) + 1);
    }
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([token]) => token);
}

function buildExcerptDigest(files: SourceFileInput[]): string {
  return files
    .filter((file) => file.excerpt)
    .slice(0, 3)
    .map((file) => `${file.name}: ${file.excerpt?.replace(/\s+/g, " ").slice(0, 120)}`)
    .join(" | ");
}

export function analyzeSourceFiles(sourceFiles: SourceFileInput[]): SourceAnalysis {
  const fileTypeCounts = new Map<string, number>();

  for (const file of sourceFiles) {
    const key = detectFileKey(file);
    fileTypeCounts.set(key, (fileTypeCounts.get(key) ?? 0) + 1);
  }

  return {
    totalFiles: sourceFiles.length,
    filesWithExcerpt: sourceFiles.filter((file) => Boolean(file.excerpt)).length,
    fileTypeBreakdown: [...fileTypeCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([key, count]) => ({ key, count })),
    topSourceFiles: [...sourceFiles]
      .map((file) => ({
        name: file.name,
        relativePath: file.relativePath,
        excerptLength: file.excerpt?.length ?? 0,
      }))
      .sort((left, right) => right.excerptLength - left.excerptLength || left.name.localeCompare(right.name))
      .slice(0, 5),
    keywordHints: collectKeywordHints(sourceFiles),
    excerptDigest: buildExcerptDigest(sourceFiles),
  };
}
