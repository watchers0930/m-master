import { z } from "zod";
import { SerpApiClient, SerpApiError, type SerpApiResponse } from "@/lib/external/serpapi";
import { sanitizeVendorResponse } from "@/lib/external/vendor-response";
import { MARKET_ENGINES } from "@/lib/market/constants";
import { citationHost } from "../normalize";
import type { Citation, EngineResult, VisibilityEngine } from "./types";

/**
 * 네이버 AI 브리핑(SerpApi) — 2단계 수집.
 * 1) engine=naver: 통합검색에 실제로 뜬 브리핑만 '노출'로 본다(사용자 눈 기준).
 * 2) 통합검색이 브리핑을 나중에 불러오는 경우(serpapi_link만 옴)에만 engine=naver_ai_overview로 본문을 가져온다.
 * naver_ai_overview를 처음부터 쓰지 않는 이유: 통합검색에 안 뜨는 질의에도 브리핑을 생성해 돌려줘 노출이 부풀려진다
 * (2026-11-26 실측: 5건 중 통합검색 미노출 2건도 overview는 브리핑 반환).
 * 비용: 무료 요금제 월 250회 — 원화 비용 0으로 기록하고, 한도 소진은 과금 없는 실패(vendor_payment_required).
 */
const reference = z
  .object({
    index: z.union([z.number(), z.string()]).optional(),
    title: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
  })
  .passthrough();
const briefing = z
  .object({
    markdown: z.string().nullable().optional(),
    references: z.array(reference).nullable().optional(),
    text_blocks: z.unknown().optional(),
    serpapi_link: z.string().optional(),
  })
  .passthrough();
type Briefing = z.infer<typeof briefing>;

function parseBriefing(value: unknown): Briefing | null {
  if (value == null) return null;
  const parsed = briefing.safeParse(value);
  if (!parsed.success) throw new SerpApiError("vendor_invalid_response");
  return parsed.data;
}

function citationsOf(refs: Briefing["references"]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const ref of refs ?? []) {
    const url = ref.link ?? undefined;
    if (!url || seen.has(url) || !citationHost(url)) continue;
    seen.add(url);
    citations.push({ url, ...(ref.title ? { title: ref.title } : {}), position: citations.length + 1 });
  }
  return citations;
}

function toResult(source: string, parsed: Briefing | null): EngineResult {
  // 본문·인용·보관본 모두 정리된 사본에서 만든다 — 응답에 키가 섞여 와도 DB·화면에 남지 않게.
  const data = parsed
    ? (sanitizeVendorResponse({ markdown: parsed.markdown, references: parsed.references, text_blocks: parsed.text_blocks }) as Briefing)
    : null;
  const answerText = data?.markdown?.trim() ?? "";
  return {
    engine: "naver_ai_briefing",
    source,
    status: answerText ? "ok" : "no_result",
    answerText,
    citations: answerText ? citationsOf(data?.references) : [],
    // 진단용으로 브리핑 블록만 보관(통합검색 웹 결과·광고는 저장하지 않음).
    raw: data,
    costKrw: 0,
  };
}

export function createNaverAiBriefing(client: () => SerpApiClient = () => new SerpApiClient()): VisibilityEngine {
  return {
    id: "naver_ai_briefing",
    source: "serpapi_naver",
    supportsMarket: (market) => MARKET_ENGINES[market]?.includes("naver_ai_briefing") ?? false,
    async capture(query, market, context) {
      if (!MARKET_ENGINES[market]?.includes("naver_ai_briefing"))
        throw new SerpApiError("unsupported_market");
      const deadline = context.deadline ?? Date.now() + 45000;
      const api = client();
      const search: SerpApiResponse = await api.search("naver", query, deadline);
      const inline = parseBriefing(search.ai_briefing);
      if (inline?.markdown?.trim()) return toResult("serpapi_naver", inline);
      if (!inline?.serpapi_link) return toResult("serpapi_naver", null);
      // 통합검색에 브리핑 자리가 있고 본문만 지연 로딩 → 브리핑 전용 조회로 본문 확보(한도 1 추가 차감).
      const overview = await api.search("naver_ai_overview", query, deadline);
      return toResult("serpapi_naver_ai_overview", parseBriefing(overview));
    },
  };
}

export const naverAiBriefing = createNaverAiBriefing();
