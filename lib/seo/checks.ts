import type { CheckStatus, SeoCheckResult } from "@/types/seo";
import type { Page, Checkpoint } from "./adapters/types";
import { citationHost } from "@/lib/visibility/normalize";
const definitions = [
  ["http_access", "HTTP 접근", 12],
  ["robots_allowed", "robots 크롤 허용", 8],
  ["indexability", "Indexability", 12],
  ["canonical", "Canonical", 10],
  ["https", "HTTPS 제공", 8],
  ["https_redirect", "HTTP→HTTPS 리디렉션", 5],
  ["title_present", "Title 존재", 8],
  ["title_quality", "Title 길이·중복", 5],
  ["desc_present", "Description 존재", 7],
  ["desc_quality", "Description 길이·중복", 5],
  ["h1", "H1 존재·중복", 5],
  ["heading_structure", "헤딩 구조", 3],
  ["structured_data", "구조화 데이터", 5],
  ["image_alt", "이미지 alt", 3],
  ["internal_links", "내부 링크 오류", 4],
] as const;
const booleanCheck = (
  p: Page,
  key: string,
  bad: CheckStatus = "fail",
): CheckStatus =>
  typeof p.checks[key] === "boolean"
    ? p.checks[key]
      ? bad
      : "pass"
    : "unknown";
function quality(
  p: Page,
  pages: Page[],
  field: "title" | "description",
  low: number,
  high: number,
): CheckStatus {
  const value = p[field];
  if (value === null) return "unknown";
  if (!value.trim()) return "fail";
  return value.length < low ||
    value.length > high ||
    pages.filter((other) => other[field] === value).length > 1
    ? "warning"
    : "pass";
}
function evaluate(key: string, p: Page, pages: Page[]): CheckStatus {
  switch (key) {
    case "http_access":
      return p.status === null
        ? "unknown"
        : p.status >= 200 && p.status < 300
          ? "pass"
          : p.status < 400
            ? "warning"
            : "fail";
    // is_robots_txt is not evidence that crawling is permitted. Missing evidence stays unknown.
    case "robots_allowed":
      return "unknown";
    case "indexability":
      return booleanCheck(p, "noindex");
    case "canonical":
      if (p.canonical === null) return "unknown";
      if (!p.canonical) return "warning";
      return !citationHost(p.canonical)
        ? "fail"
        : citationHost(p.canonical) === citationHost(p.url)
          ? "pass"
          : "warning";
    case "https":
      return p.url.startsWith("https://") ? "pass" : "fail";
    case "https_redirect":
      return "unknown";
    case "title_present":
      return p.title === null ? "unknown" : p.title.trim() ? "pass" : "fail";
    case "title_quality":
      return quality(p, pages, "title", 10, 60);
    case "desc_present":
      return p.description === null
        ? "unknown"
        : p.description.trim()
          ? "pass"
          : "fail";
    case "desc_quality":
      return quality(p, pages, "description", 50, 160);
    case "h1":
      return p.h1 === null ? "unknown" : p.h1.length === 1 ? "pass" : "warning";
    case "structured_data":
      return p.checks.has_micromarkup === false
        ? "not_applicable"
        : p.checks.has_micromarkup === true
          ? booleanCheck(p, "has_micromarkup_errors")
          : "unknown";
    case "image_alt":
      return booleanCheck(p, "no_image_alt", "warning");
    // Presence alone does not prove syntax validity, heading order or link response codes.
    default:
      return "unknown";
  }
}
export interface EvaluatedChecks {
  checks: SeoCheckResult[];
  coefficients: Record<string, number>;
}
export function technicalChecks(
  pages: Page[],
  collection?: Checkpoint["collection"],
): EvaluatedChecks {
  const coefficients: Record<string, number> = {};
  const checks = definitions.map(([key, label, weight]): SeoCheckResult => {
    const outcomes = pages.map((p) => ({
      url: p.url,
      status: evaluate(key, p, pages),
    }));
    const extended = collection?.extendedStatus;
    const domainFailure =
      (key === "robots_allowed" && extended === "forbidden_robots") ||
      (key === "indexability" &&
        ["forbidden_meta_tag", "forbidden_http_header"].includes(
          extended ?? "",
        )) ||
      (key === "http_access" && extended === "site_unreachable");
    if (domainFailure)
      outcomes.push({ url: pages[0]?.url ?? "", status: "fail" });
    const na =
      outcomes.length > 0 &&
      outcomes.every((p) => p.status === "not_applicable");
    const evaluated = outcomes.filter(
      (p) => p.status !== "unknown" && p.status !== "not_applicable",
    );
    const failed = evaluated.filter((p) => p.status !== "pass");
    const factor = evaluated.length
      ? evaluated.reduce(
          (n, p) =>
            n + (p.status === "pass" ? 1 : p.status === "warning" ? 0.5 : 0),
          0,
        ) / evaluated.length
      : null;
    if (factor !== null) coefficients[key] = factor;
    return {
      key,
      label,
      weight,
      status: na
        ? "not_applicable"
        : factor === null
          ? "unknown"
          : factor === 1
            ? "pass"
            : evaluated.some((p) => p.status === "fail")
              ? "fail"
              : "warning",
      detail: domainFailure
        ? "크롤 수집 정책 또는 접근 제한이 확인되었습니다."
        : na
          ? "수집 표본에 적용된 구조화 데이터가 없습니다."
          : factor === null
            ? "반환 근거가 없어 판정할 수 없습니다."
            : `정적 HTML 수집 표본 ${evaluated.length}개 기준`,
      evaluatedSamples: evaluated.length,
      failedSamples: failed.length,
      affectedUrls: failed
        .filter((p) => p.url)
        .slice(0, 20)
        .map((p) => p.url),
      ...(key === "structured_data" &&
      pages.some((p) => p.checks.has_micromarkup === true)
        ? {
            subFindings: [
              { label: "구조화 데이터 존재", status: "pass" as const },
              {
                label: "구문 오류 근거",
                status: pages.some(
                  (p) => p.checks.has_micromarkup_errors === true,
                )
                  ? ("fail" as const)
                  : pages.some((p) => p.checks.has_micromarkup_errors === false)
                    ? ("pass" as const)
                    : ("unknown" as const),
              },
            ],
          }
        : {}),
      recommendation: failed.length ? `${label} 항목을 확인하세요.` : null,
    };
  });
  return { checks, coefficients };
}
