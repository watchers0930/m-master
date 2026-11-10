// lib/ads/keywords.ts — 네이버 키워드 도구 리서치(제안 Task 7·8의 입력 통계).
// - researchKeywords: 씨앗을 정제해 5개씩 GET /keywordstool?hintKeywords=a,b,…&showDetail=1(배치는 순차, 재시도는 클라이언트 몫).
//   응답은 zod로 검증한다. 형태 오류는 빈 결과가 아니라 ads_unexpected_response(502)다. keywordList 없음·null·[] → 빈 결과.
//   배치 하나라도 실패하면 그 NaverAdsError를 그대로 전파한다(부분 결과를 돌려주지 않는다 — 조용히 누락된 통계로 제안하지 않게).
//   결과: 정규화 키워드로 중복 제거(먼저 본 것 유지) → 공백뿐·특수문자 키워드 제외(네이버 3906) → (pcQc+mobileQc) 내림차순
//   ("< 10"은 0으로 계산) → 키워드 코드단위 오름차순 → 상위 200.
// - collectSeeds: 수동 > SEO 키워드(seo_keywords, 검색량 내림차순) > 최신 '완료' 컨설팅 리포트의 전략 입력 키워드, 정제·중복 제거 후 최대 25개.
//   모든 조회는 ownerId AND domainId로 범위를 건다(다른 소유자의 도메인 id면 저장 출처에서 0건). 수동 씨앗은 호출자 본인의 입력이라 그대로 쓴다.
//   전략 키워드: consultingStrategySchema(strategyJson)에는 키워드 필드가 없다. 전략은 리포트에 고정된 입력 스냅샷의
//   structuredMetrics.keywords(v2 이상)로 생성되므로 그 keyword를 쓴다. v1 스냅샷·형태 불일치면 전략 출처는 0건.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { NaverAdsClient } from "@/lib/external/naver-searchad";
import { naverKeywordToolSchema, type NaverKeywordRow } from "@/schemas/ads";
import { unexpectedNaverResponse } from "./http";

export type KeywordStat = {
  keyword: string;
  pcQc: number | null;
  mobileQc: number | null;
  lt10: boolean;
  compIdx: "낮음" | "중간" | "높음" | null;
  pcCtr: number | null;
  mobileCtr: number | null;
  plAvgDepth: number | null;
};

export const MAX_SEEDS = 25;
const HINTS_PER_CALL = 5; // 명세: hintKeywords는 쉼표 구분 최대 5개
const MAX_SEED_LENGTH = 40;
const MAX_RESULTS = 200;
const SEO_SEED_TAKE = 50;
const SEED_RE = /^[가-힣A-Za-z0-9]+$/;
const RESULT_RE = /^[가-힣A-Za-z0-9]+(?: [가-힣A-Za-z0-9]+)*$/;
const LT10_RE = /^<\s*10$/;
const COMP_IDX: Readonly<Record<string, KeywordStat["compIdx"]>> = {
  낮음: "낮음", 중간: "중간", 높음: "높음", low: "낮음", mid: "중간", middle: "중간", medium: "중간", high: "높음",
};

const collapse = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");
const dedupeKey = (text: string) => text.replace(/ /g, "").toLowerCase();

/** 씨앗 정제: NFC·trim·공백 제거(네이버가 공백 힌트를 거부하는지는 미검증 — 안전한 쪽), 빈 값·40자 초과·한글/영문/숫자 외 문자 제외,
 *  대소문자 무시 중복 제거. 입력 순서를 유지한다. */
export function sanitizeSeeds(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const seed = collapse(value).replace(/ /g, "");
    if (!seed || seed.length > MAX_SEED_LENGTH || !SEED_RE.test(seed)) continue;
    const key = seed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seed);
  }
  return out;
}

// 조회수: 음이 아닌 유한 숫자만 값. "< 10"(명세는 "<10")은 null + lt10. 그 밖의 문자열·음수는 null.
function count(value: NaverKeywordRow["monthlyPcQcCnt"]): { value: number | null; lt10: boolean } {
  if (typeof value === "number") return { value: Number.isFinite(value) && value >= 0 ? value : null, lt10: false };
  return { value: null, lt10: typeof value === "string" && LT10_RE.test(value.trim()) };
}
const metric = (value: NaverKeywordRow["plAvgDepth"]) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

function toStat(row: NaverKeywordRow): KeywordStat | null {
  const keyword = collapse(row.relKeyword);
  if (!RESULT_RE.test(keyword)) return null;
  const pc = count(row.monthlyPcQcCnt), mobile = count(row.monthlyMobileQcCnt);
  return {
    keyword,
    pcQc: pc.value,
    mobileQc: mobile.value,
    lt10: pc.lt10 || mobile.lt10,
    compIdx: typeof row.compIdx === "string" ? (COMP_IDX[row.compIdx.trim().toLowerCase()] ?? null) : null,
    pcCtr: metric(row.monthlyAvePcCtr),
    mobileCtr: metric(row.monthlyAveMobileCtr),
    plAvgDepth: metric(row.plAvgDepth),
  };
}

const volume = (k: KeywordStat) => (k.pcQc ?? 0) + (k.mobileQc ?? 0);
const byVolume = (a: KeywordStat, b: KeywordStat) =>
  volume(b) - volume(a) || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0);

export async function researchKeywords(client: NaverAdsClient, seeds: readonly string[]): Promise<KeywordStat[]> {
  const hints = sanitizeSeeds(seeds).slice(0, MAX_SEEDS);
  const seen = new Set<string>();
  const stats: KeywordStat[] = [];
  for (let i = 0; i < hints.length; i += HINTS_PER_CALL) {
    const batch = hints.slice(i, i + HINTS_PER_CALL);
    const parsed = naverKeywordToolSchema.safeParse(await client.get("/keywordstool", { hintKeywords: batch.join(","), showDetail: 1 }));
    if (!parsed.success) throw unexpectedNaverResponse();
    for (const row of parsed.data.keywordList ?? []) {
      const stat = toStat(row);
      if (!stat || seen.has(dedupeKey(stat.keyword))) continue;
      seen.add(dedupeKey(stat.keyword));
      stats.push(stat);
    }
  }
  return stats.sort(byVolume).slice(0, MAX_RESULTS);
}

const strategyKeywordsSchema = z.array(z.object({ keyword: z.string() })).max(SEO_SEED_TAKE);

async function seoSeeds(ownerId: string, domainId: string): Promise<string[]> {
  const rows = await prisma.seoKeyword.findMany({
    where: { domainId, domain: { ownerId } },
    select: { keyword: true },
    orderBy: [{ searchVolume: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: SEO_SEED_TAKE,
  });
  return rows.map((r) => r.keyword);
}

async function strategySeeds(ownerId: string, domainId: string): Promise<string[]> {
  // 스냅샷 전체(증거 최대 1만 건)를 읽지 않고 키워드 배열(스키마상 최대 50)만 꺼낸다. 리포트·도메인 소유자를 모두 확인한다.
  const rows = await prisma.$queryRaw<{ keywords: unknown }[]>(Prisma.sql`
    SELECT r.input_snapshot #> '{structuredMetrics,keywords}' AS keywords
    FROM consulting_reports r JOIN domains d ON d.id = r.domain_id
    WHERE r.owner_id = ${ownerId} AND d.owner_id = ${ownerId} AND r.domain_id = ${domainId} AND r.status = 'completed'
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1`);
  const parsed = strategyKeywordsSchema.safeParse(rows[0]?.keywords);
  return parsed.success ? parsed.data.map((k) => k.keyword) : [];
}

/** 제안 씨앗: 수동 > SEO > 최신 완료 컨설팅 전략, 정제·중복 제거 후 최대 25개. 앞 출처로 다 차면 뒤 출처는 조회하지 않는다. */
export async function collectSeeds(ownerId: string, domainId: string, manual: readonly unknown[]): Promise<string[]> {
  let seeds = sanitizeSeeds(manual.slice(0, 200)).slice(0, MAX_SEEDS);
  if (seeds.length < MAX_SEEDS) seeds = sanitizeSeeds([...seeds, ...(await seoSeeds(ownerId, domainId))]).slice(0, MAX_SEEDS);
  if (seeds.length < MAX_SEEDS) seeds = sanitizeSeeds([...seeds, ...(await strategySeeds(ownerId, domainId))]).slice(0, MAX_SEEDS);
  return seeds;
}
