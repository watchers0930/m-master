import type { VendorEnvelope } from "@/lib/external/dataforseo";
import {
  array,
  object,
  text,
  number,
  url,
  checkpointSchema,
  type FrozenInput,
} from "./types";
export function onpageRequest(operation: string, input: FrozenInput) {
  const options = {
    enable_javascript: false,
    load_resources: false,
    enable_browser_rendering: false,
  };
  if (operation === "onpage_crawl")
    return {
      path: "on_page/task_post",
      body: [{ target: input.host, max_crawl_pages: 20, ...options }],
      units: 20,
    };
  return {
    path: "on_page/instant_pages",
    body: (input.paths ?? ["/"]).map((path) => ({
      url: new URL(path, `https://${input.host}`).href,
      ...options,
    })),
    units: (input.paths ?? ["/"]).length,
  };
}
/** Instant batches must account for every requested URL, independently of task order. */
export function parseOnpage(response: VendorEnvelope, input?: FrozenInput) {
  if (!input) return parsePages(response);
  const requested = (input.paths ?? ["/"]).map(
    (path) => new URL(path, `https://${input.host}`).href,
  );
  const canonical = (value: unknown) => {
    try {
      return typeof value === "string" ? new URL(value).href : null;
    } catch {
      return null;
    }
  };
  const tasks = response.tasks ?? [];
  const addresses = tasks.map((task) => {
    const echoed = canonical(object(task.data).url);
    if (echoed) return echoed;
    const items = (task.result ?? []).flatMap((r) => array(object(r).items));
    return items.length === 1 ? canonical(object(items[0]).url) : null;
  });
  const pages: import("./types").Page[] = [];
  const pageFailures: import("./types").Checkpoint["pageFailures"] = [];
  for (const address of requested) {
    const matches = tasks.filter((_task, i) => addresses[i] === address);
    const task = matches[0];
    const parsed = task ? parsePages({ ...response, tasks: [task] }).pages : [];
    const reason =
      response.status_code !== 20000
        ? "vendor_failed"
        : matches.length > 1
          ? "duplicate_task"
          : !task
            ? "missing_task"
            : task.status_code !== 20000
              ? "vendor_failed"
              : parsed.length === 0
                ? "missing_page"
                : parsed.length !== 1 || canonical(parsed[0].url) !== address
                  ? "url_mismatch"
                  : tasks.length > requested.length ||
                      addresses.some(
                        (v) => v !== null && !requested.includes(v),
                      )
                    ? "url_mismatch"
                    : null;
    if (reason)
      pageFailures.push({
        url: address,
        reason,
        vendorStatus: task?.status_code ?? null,
      });
    else pages.push(...parsed);
  }
  return checkpointSchema.parse({
    pages,
    pageFailures,
    crawledPages: pages.length,
  });
}
function parsePages(response: VendorEnvelope) {
  const results = response.tasks?.flatMap((t) => t.result ?? []) ?? [];
  const pages = results
    .flatMap((r) => array(object(r).items))
    .slice(0, 20)
    .flatMap((value) => {
      const p = object(value),
        meta = object(p.meta);
      const address = url(p.url);
      if (!address) return [];
      const checks = Object.fromEntries(
        Object.entries(object(p.checks)).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      );
      const h1 = object(meta.htags).h1;
      return [
        {
          url: address,
          status: number(p.status_code),
          title: text(meta.title),
          description: text(meta.description, 4000),
          canonical: text(meta.canonical, 2048),
          h1: Array.isArray(h1)
            ? h1
                .filter((v): v is string => typeof v === "string")
                .slice(0, 100)
                .map((v) => v.slice(0, 2000))
            : null,
          checks,
        },
      ];
    });
  return checkpointSchema.parse({ pages, crawledPages: pages.length });
}
