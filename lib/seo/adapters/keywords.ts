import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { citationHost } from "@/lib/visibility/normalize";
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
  const wanted = input.keywords?.length
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
