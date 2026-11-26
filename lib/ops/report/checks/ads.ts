// lib/ops/report/checks/ads.ts — 네이버 검색광고: 지출 감시 생존, 비즈머니, 어제 성과(기록 유무 구분), 미발송 알림, 실제 노출 경로.
// - '노출 가능' = 켜진 캠페인 → 그 아래 켜진 그룹 → 그 그룹의 켜지고 심사 통과한 키워드와 소재가 함께 있는 경로가 하나라도 있을 때
//   (항목별 개수만 보면 서로 다른 그룹의 키워드·소재로 '노출 가능' 오판 — codex MED). 2026-11-26 캠페인만 켜져 노출 0이던 사례가 출발점.
// - 심사 동기화·성과 수집 크론의 생존은 checks/crons.ts가 본다(여기서는 성과 행이 없으면 '0'이 아니라 '기록 없음').
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kstDate, MAX_ATTEMPTS } from "@/lib/ads/alerts";
import { ago, krw, type CheckContext, type CheckResult } from "../types";

export const GUARD_STALE_MINUTES = 90; // 감시는 30분마다 — 3회 연속 빠지면 이상
export const BIZMONEY_WARN_KRW = 10000;
export const MAX_ACCOUNTS = 100;

type Account = { id: string; label: string; status: string; last_guard_at: Date | null; last_bizmoney_krw: number | null };
type State = {
  c_on: number; c_total: number; g_on: number; g_total: number; k_on: number; k_total: number; r_on: number; r_total: number; serving: boolean;
};
type Perf = { rows: number; cost: number; clk: number; ccnt: number; imp: number };

export async function checkAds({ now }: CheckContext, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<CheckResult> {
  const base = { key: "ads", title: "네이버 검색광고" };
  const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM ad_accounts`;
  if (!total) return { ...base, level: "info", summary: "연결된 광고 계정이 없습니다.", lines: [] };
  // 감시가 가장 오래 안 돈 계정부터(멈춘 계정이 상한 밖으로 밀리지 않게).
  const accounts = await db.$queryRaw<Account[]>`
    SELECT id, label, status, last_guard_at, last_bizmoney_krw FROM ad_accounts
    ORDER BY last_guard_at ASC NULLS FIRST, id LIMIT ${MAX_ACCOUNTS}`;
  const yesterday = kstDate(new Date(now.getTime() - 864e5));
  let level = "ok" as CheckResult["level"];
  const raise = (to: CheckResult["level"]) => { if (to === "error" || (to === "warn" && level === "ok")) level = to; };
  const lines: string[] = [];
  for (const a of accounts) {
    const head = `[${a.label.length > 20 ? `${a.label.slice(0, 20)}…` : a.label}]`;
    if (a.status !== "active") { raise("warn"); lines.push(`${head} 계정 상태 ${a.status}`); continue; }
    const guardStale = !a.last_guard_at || now.getTime() - a.last_guard_at.getTime() > GUARD_STALE_MINUTES * 60000;
    if (guardStale) raise("error");
    const biz = a.last_bizmoney_krw;
    if (biz !== null && biz < BIZMONEY_WARN_KRW) raise("warn");
    lines.push(`${head} 지출 감시 ${ago(a.last_guard_at, now)}${guardStale ? " ⛔멈춤" : ""} · 비즈머니 ${biz === null ? "모름" : krw(biz)}`);

    const [s] = await db.$queryRaw<State[]>`
      SELECT
        (SELECT count(*) FILTER (WHERE NOT user_lock) FROM ad_campaigns WHERE ad_account_id = ${a.id})::int AS c_on,
        (SELECT count(*) FROM ad_campaigns WHERE ad_account_id = ${a.id})::int AS c_total,
        (SELECT count(*) FILTER (WHERE NOT user_lock) FROM ad_groups WHERE ad_account_id = ${a.id})::int AS g_on,
        (SELECT count(*) FROM ad_groups WHERE ad_account_id = ${a.id})::int AS g_total,
        (SELECT count(*) FILTER (WHERE NOT user_lock) FROM ad_keywords WHERE ad_account_id = ${a.id})::int AS k_on,
        (SELECT count(*) FROM ad_keywords WHERE ad_account_id = ${a.id})::int AS k_total,
        (SELECT count(*) FILTER (WHERE NOT user_lock) FROM ad_creatives WHERE ad_account_id = ${a.id})::int AS r_on,
        (SELECT count(*) FROM ad_creatives WHERE ad_account_id = ${a.id})::int AS r_total,
        EXISTS (
          SELECT 1 FROM ad_campaigns c JOIN ad_groups g ON g.ad_account_id = c.ad_account_id AND g.parent_naver_id = c.naver_id
          WHERE c.ad_account_id = ${a.id} AND NOT c.user_lock AND NOT g.user_lock
            AND EXISTS (SELECT 1 FROM ad_keywords k WHERE k.ad_account_id = g.ad_account_id AND k.parent_naver_id = g.naver_id
                          AND NOT k.user_lock AND k.inspect_status IN ('APPROVED', 'ELIGIBLE'))
            AND EXISTS (SELECT 1 FROM ad_creatives r WHERE r.ad_account_id = g.ad_account_id AND r.parent_naver_id = g.naver_id
                          AND NOT r.user_lock AND r.inspect_status IN ('APPROVED', 'ELIGIBLE'))
        ) AS serving`;
    const anyOn = s.c_on + s.g_on + s.k_on + s.r_on > 0;
    lines.push(
      `${head} 켜짐 캠페인 ${s.c_on}/${s.c_total} · 그룹 ${s.g_on}/${s.g_total} · 키워드 ${s.k_on}/${s.k_total} · 소재 ${s.r_on}/${s.r_total} → ` +
        (s.serving ? "노출 가능" : anyOn ? "⚠️일부만 켜짐(노출 경로 없음)" : "모두 꺼짐"),
    );
    if (anyOn && !s.serving) raise("warn");

    const [p] = await db.$queryRaw<Perf[]>`
      SELECT count(*)::int AS rows, coalesce(sum(cost_krw),0)::int AS cost, coalesce(sum(clk_cnt),0)::int AS clk,
             coalesce(sum(ccnt),0)::int AS ccnt, coalesce(sum(imp_cnt),0)::int AS imp
      FROM ad_performance_daily WHERE ad_account_id = ${a.id} AND entity_type = 'campaign' AND date = ${yesterday}::date`;
    if (p.rows === 0) {
      // 노출 중인데 어제 성과가 없으면 수집이 빠진 것(0원과 다르다).
      if (s.serving) raise("warn");
      lines.push(`${head} 어제(${yesterday}) 성과 기록 없음${s.serving ? " ⚠️노출 중인데 수집 안 됨" : ""}`);
    } else {
      lines.push(`${head} 어제(${yesterday}) 노출 ${p.imp} · 클릭 ${p.clk} · 지출 ${krw(p.cost)} · 전환 ${p.ccnt}`);
    }
  }
  if (total > accounts.length) { raise("warn"); lines.push(`외 ${total - accounts.length}개 계정은 이번 보고서에서 생략(상한 ${MAX_ACCOUNTS})`); }
  const [alerts] = await db.$queryRaw<{ unsent: number }[]>`
    SELECT count(*)::int AS unsent FROM ad_alerts WHERE sent_at IS NULL AND attempts < ${MAX_ATTEMPTS}`;
  if (alerts.unsent > 0) { raise("warn"); lines.push(`보내지 못한 광고 알림 ${alerts.unsent}건`); }
  const summary = level === "error" ? "지출 감시가 멈췄습니다." : level === "warn" ? "확인할 항목이 있습니다." : "정상";
  return { ...base, level, summary, lines };
}
