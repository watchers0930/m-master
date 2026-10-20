import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { citationHost } from "@/lib/visibility/normalize";
import {
  array,
  object,
  number,
  url,
  checkpointSchema,
  type FrozenInput,
} from "./types";
export function serpRequest(input: FrozenInput) {
  const { location_code, language_code } = MARKET_LOCATIONS[input.market];
  const common = {
    keyword: input.keyword,
    device: "desktop",
    max_crawl_pages: 1,
  };
  return {
    path: `serp/${input.engine}/organic/task_post`,
    body: [
      input.engine === "naver"
        ? common
        : { ...common, location_code, language_code, depth: 100 },
    ],
    units: 1,
  };
}
export function parseSerp(response: VendorEnvelope, input: FrozenInput) {
  const results = response.tasks?.flatMap((t) => t.result ?? []) ?? [];
  const items = results
    .flatMap((r) => array(object(r).items))
    .map(object)
    .filter((i) => i.type === "organic");
  const valid = items.filter(
    (i) => number(i.rank_group) !== null && Number(i.rank_group) > 0,
  );
  const matches = valid
    .filter((i) => citationHost(String(i.url)) === input.host)
    .sort((a, b) => Number(a.rank_group) - Number(b.rank_group));
  const best = matches[0];
  return checkpointSchema.parse({
    observations: [
      {
        keyword: input.keyword,
        engine: input.engine,
        source: "serp",
        rank: best ? number(best.rank_group) : null,
        rankAbsolute: best ? number(best.rank_absolute) : null,
        matchedUrl: best ? url(best.url) : null,
        status: best
          ? "ranked"
          : valid.length
            ? "not_found_in_range"
            : "no_result",
        returnedRange: valid.length
          ? Math.max(...valid.map((i) => Number(i.rank_group)))
          : 0,
        sourceObservedAt: null,
      },
    ],
  });
}
