import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { citationHost } from "@/lib/visibility/normalize";
import { SEED_LIMIT } from "../seed-keywords";
import {
  array,
  object,
  text,
  number,
  url,
  checkpointSchema,
  type FrozenInput,
  type Metric,
  type Observation,
} from "./types";
export function keywordsRequest(operation: string, input: FrozenInput) {
  const { location_code, language_code } = MARKET_LOCATIONS[input.market];
  if (operation === "labs_ranked")
    return {
      path: "dataforseo_labs/google/ranked_keywords/live",
      body: [
        {
          target: input.host,
          location_code,
          language_code,
          limit: 100,
          filters: ["ranked_serp_element.serp_item.type", "=", "organic"],
        },
      ],
      units: 100,
    };
  // 주제(씨앗) 키워드가 있으면 그 키워드와 관련된 검색어를, 없으면 첫 화면 기준 사이트 키워드를 찾는다(같은 단가 $0.09, 2026-11-26 실측).
  // 첫 화면이 주제와 다른 내용(예: AI 소개)이면 사이트 기준 결과가 무관한 키워드로 채워져 자동 순위 비용이 엉뚱한 곳에 쓰였다.
  if (operation === "keywords_for_site" && input.keywords?.length)
    return {
      path: "keywords_data/google_ads/keywords_for_keywords/live",
      body: [
        {
          keywords: input.keywords.slice(0, SEED_LIMIT),
          location_code,
          language_code,
          sort_by: "search_volume",
        },
      ],
      units: 1,
    };
  return {
    path: "keywords_data/google_ads/keywords_for_site/live",
    body: [{ target: input.host, location_code, language_code }],
    units: 1,
  };
}
export function parseKeywords(
  response: VendorEnvelope,
  operation: string,
  input: FrozenInput,
) {
  const results = response.tasks?.flatMap((t) => t.result ?? []) ?? [];
  const rows =
    operation === "labs_ranked"
      ? results.flatMap((r) => array(object(r).items))
      : results;
  const metrics: Metric[] = [],
    observations: Observation[] = [];
  // 네이버 볼륨만 요청한 키워드로 거른다. 구글 광고 키워드는 씨앗을 넣어 받은 관련 검색어 전체가 결과다.
  const wanted =
    operation === "naver_volume" && input.keywords?.length
      ? new Set(input.keywords.map((v) => v.normalize("NFKC").toLowerCase()))
      : null;
  for (const value of rows.slice(0, 100)) {
    const row = object(value),
      data = operation === "labs_ranked" ? object(row.keyword_data) : row;
    const keyword = text(data.keyword, 200)?.normalize("NFKC").trim();
    if (!keyword || (wanted && !wanted.has(keyword.toLowerCase()))) continue;
    const info = operation === "labs_ranked" ? object(data.keyword_info) : data;
    const raw = info.competition;
    const numeric = number(raw);
    const index = number(info.competition_index);
    const periods = array(info.monthly_searches)
      .map(object)
      .filter((m) => number(m.year) !== null && number(m.month) !== null)
      .map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`)
      .sort();
    metrics.push({
      keyword,
      engine: "google",
      searchVolume: number(info.search_volume),
      volumeScale:
        typeof info.search_volume === "string"
          ? info.search_volume.slice(0, 200)
          : null,
      volumePeriod:
        text(info.last_updated_time, 200) ??
        (periods.length ? `${periods[0]}/${periods.at(-1)}` : null),
      competition:
        index !== null && index <= 100
          ? index / 100
          : numeric !== null && numeric <= 1
            ? numeric
            : null,
      competitionRaw: raw == null ? null : String(raw).slice(0, 200),
    });
    if (operation === "labs_ranked") {
      const ranked = object(row.ranked_serp_element),
        item = object(ranked.serp_item),
        address = url(item.url);
      if (
        item.type !== "organic" ||
        !address ||
        citationHost(address) !== input.host
      )
        continue;
      const rank = number(item.rank_group);
      if (!rank) continue;
      const observed = text(object(data.serp_info).last_updated_time, 200);
      const parsed = observed ? Date.parse(observed) : NaN;
      observations.push({
        keyword,
        engine: "google",
        source: "labs",
        rank,
        rankAbsolute: number(item.rank_absolute),
        matchedUrl: address,
        status: "ranked",
        returnedRange: null,
        sourceObservedAt: Number.isFinite(parsed)
          ? new Date(parsed).toISOString()
          : null,
      });
    }
  }
  return checkpointSchema.parse({ metrics, observations });
}
