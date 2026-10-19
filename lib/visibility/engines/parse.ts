import { z } from "zod";
import type { Citation, EngineId, EngineResult } from "./types";
import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { citationHost } from "../normalize";
import { sanitizeVendorResponse } from "@/lib/external/vendor-response";
const node = z
  .object({
    type: z.string().optional(),
    text: z.string().nullable().optional(),
    markdown: z.string().nullable().optional(),
  })
  .passthrough();
type Node = z.infer<typeof node>;
function nodes(value: unknown): Node[] {
  return value == null ? [] : z.array(node).parse(value);
}
export function normalizeVendor(
  engine: EngineId,
  source: string,
  response: VendorEnvelope,
): EngineResult {
  const text: string[] = [],
    citations: Citation[] = [];
  const citationUrls = new Set<string>();
  const add = (value: unknown) => {
    for (const ref of nodes(value)) {
      const web =
        ref.web && typeof ref.web === "object"
          ? (ref.web as Record<string, unknown>)
          : ref;
      const url =
        typeof web.url === "string"
          ? web.url
          : typeof web.uri === "string"
            ? web.uri
            : undefined;
      if (url && citationHost(url) && !citationUrls.has(url)) {
        citationUrls.add(url);
        citations.push({
          url,
          ...(typeof web.title === "string" ? { title: web.title } : {}),
          position: citations.length + 1,
        });
      }
    }
  };
  const visit = (items: Node[]) => {
    for (const item of items) {
      if (/reasoning|thinking/.test(item.type ?? "")) continue;
      if (source === "llm_responses" || source === "passthrough") {
        if (item.type !== "message") continue;
        for (const section of nodes(item.sections)) {
          if (section.text) text.push(section.text);
          add(section.annotations);
        }
      } else {
        if (item.text || item.markdown)
          text.push(item.text || item.markdown || "");
        add(item.sources);
        add(item.references);
        add(item.annotations);
        add(item.groundingChunks);
        add(item.grounding_chunks);
        if (item.type === "url_citation") add([item]);
        visit(nodes(item.items));
        visit(nodes(item.sections));
      }
    }
  };
  for (const result of nodes(response.tasks?.[0]?.result)) {
    if (engine === "ai_overviews") {
      const aio = nodes(result.items).filter(
        (item) => item.type === "ai_overview",
      );
      visit(aio);
    } else {
      visit(nodes(result.items));
      add(result.sources);
      add(result.groundingChunks);
      add(result.grounding_chunks);
    }
  }
  const answerText = text.join("\n").trim();
  // Retain result payloads only: task request echoes and authentication headers are omitted.
  return {
    engine,
    source,
    status: answerText ? "ok" : "no_result",
    answerText,
    citations,
    raw: sanitizeVendorResponse(response.tasks?.[0]?.result ?? []),
    costKrw: 0,
    taskId: response.tasks?.[0]?.id ?? undefined,
  };
}
