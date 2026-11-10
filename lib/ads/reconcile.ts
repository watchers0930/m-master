// lib/ads/reconcile.ts — 불확실한 생성(5xx·타임아웃·성공 본문 형태 불일치)을 재전송 없이 대조하는 조회(설계서 §5.3).
// - 결정적 이름으로 찾는다: 캠페인 mq-{proposalId}, 광고그룹 mq-{proposalId}-g{n}(부모 캠페인 아래), 키워드는 부모 그룹 아래 같은 키워드
//   (keywordDedupeKey 비교 — 네이버의 공백·대소문자 정리에 흔들리지 않게), 소재는 이름이 없으므로 부모 그룹 아래 같은 제목·설명(TEXT_45).
// - DELETED 엔티티와 이미 미러에 있는 id(exclude)는 후보에서 뺀다. 결과는 후보 id 목록(0·1·여럿) — 고르기는 호출자가 한다.
// - 목록은 전 페이지를 읽는다(recordSize + baseSearchId 커서, 빈 페이지까지). 커서가 진행하지 않거나 페이지 상한이면 '확인 못 함'
//   (ReconcileIncomplete) — 없다고 판정해 다시 만들지 않는다.
import type { z } from "zod";
import type { NaverAdsClient, NaverAdsQuery } from "@/lib/external/naver-searchad";
import { naverAdSchema, naverAdgroupSchema, naverCampaignSchema, naverKeywordSchema } from "@/schemas/ads";
import { ApplyFailure } from "./apply-errors";
import { CAMPAIGN_PAGE, MAX_CAMPAIGN_PAGES } from "./account-core";
import { unexpectedNaverResponse } from "./http";
import { keywordDedupeKey } from "./keyword-text";

export class ReconcileIncomplete extends ApplyFailure {
  constructor(step: string) {
    super(`uncertain:${step}`);
  }
}

async function listAll<S extends z.ZodTypeAny>(
  client: NaverAdsClient, path: string, base: NaverAdsQuery, item: S, idOf: (x: z.infer<S>) => string, step: string,
): Promise<z.infer<S>[]> {
  const seen = new Map<string, z.infer<S>>();
  const schema = item.array();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page++) {
    const query = { ...base, recordSize: CAMPAIGN_PAGE, ...(cursor ? { baseSearchId: cursor, selector: "NEXT" } : {}) };
    const parsed = schema.safeParse(await client.get(path, query));
    if (!parsed.success) throw unexpectedNaverResponse();
    const rows = parsed.data as z.infer<S>[];
    if (rows.length === 0) return [...seen.values()];
    let added = 0;
    for (const row of rows) if (!seen.has(idOf(row))) { seen.set(idOf(row), row); added++; }
    if (added === 0) break;
    cursor = idOf(rows[rows.length - 1]);
  }
  throw new ReconcileIncomplete(step);
}

const live = (x: { status?: string | null }) => x.status !== "DELETED";

export async function findCampaigns(client: NaverAdsClient, name: string, exclude: ReadonlySet<string>, step: string): Promise<string[]> {
  const rows = await listAll(client, "/ncc/campaigns", {}, naverCampaignSchema, (c) => c.nccCampaignId, step);
  return rows.filter((c) => live(c) && c.name === name && !exclude.has(c.nccCampaignId)).map((c) => c.nccCampaignId);
}

export async function findAdgroups(
  client: NaverAdsClient, campaignId: string, name: string, exclude: ReadonlySet<string>, step: string,
): Promise<string[]> {
  const rows = await listAll(client, "/ncc/adgroups", { nccCampaignId: campaignId }, naverAdgroupSchema, (g) => g.nccAdgroupId, step);
  return rows
    .filter((g) => live(g) && g.nccCampaignId === campaignId && g.name === name && !exclude.has(g.nccAdgroupId))
    .map((g) => g.nccAdgroupId);
}

export async function findKeywords(
  client: NaverAdsClient, adgroupId: string, keyword: string, exclude: ReadonlySet<string>, step: string,
): Promise<string[]> {
  const key = keywordDedupeKey(keyword);
  const rows = await listAll(client, "/ncc/keywords", { nccAdgroupId: adgroupId }, naverKeywordSchema, (k) => k.nccKeywordId, step);
  return rows
    .filter((k) => live(k) && k.nccAdgroupId === adgroupId && keywordDedupeKey(k.keyword) === key && !exclude.has(k.nccKeywordId))
    .map((k) => k.nccKeywordId);
}

const same = (a: string, b: string) => a.normalize("NFC").trim() === b.normalize("NFC").trim();

/** 소재 목록(명세: GET /ncc/ads?nccAdgroupId, 페이지 없음). 본문(ad)이 객체가 아닌 응답은 대조할 수 없어 후보가 아니다. */
export async function findAds(
  client: NaverAdsClient, adgroupId: string, creative: { headline: string; description: string }, exclude: ReadonlySet<string>,
): Promise<string[]> {
  const parsed = naverAdSchema.array().safeParse(await client.get("/ncc/ads", { nccAdgroupId: adgroupId }));
  if (!parsed.success) throw unexpectedNaverResponse();
  return parsed.data
    .filter((a) => live(a) && a.nccAdgroupId === adgroupId && a.type === "TEXT_45" && !exclude.has(a.nccAdId) && a.ad
      && same(a.ad.headline, creative.headline) && same(a.ad.description, creative.description))
    .map((a) => a.nccAdId);
}
