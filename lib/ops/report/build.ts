// lib/ops/report/build.ts — 점검을 모아 아침 보고서(제목·본문 텍스트)를 만든다.
// - 점검은 병렬·서로 독립. 점검 하나가 예외·시간 초과여도 그 항목만 '🔴 점검 실패'로 싣고 나머지는 그대로(보고서가 통째로 안 나가는 일이 없게).
// - 본문에는 키·원문 오류를 싣지 않는다(고정 사유 코드만).
import { kstDate } from "@/lib/ads/alerts";
import { checkAds } from "./checks/ads";
import { checkCrons } from "./checks/crons";
import { checkCost } from "./checks/cost";
import { checkGeo } from "./checks/geo";
import { checkPipeline } from "./checks/pipeline";
import { checkSeo } from "./checks/seo";
import { checkDataForSeo, checkSerpApi } from "./checks/vendors";
import { LEVEL_MARK, type Check, type CheckContext, type CheckResult } from "./types";

export const CHECK_TIMEOUT_MS = 20000;

interface Named { key: string; title: string; run: Check }
export const DEFAULT_CHECKS: Named[] = [
  { key: "dataforseo", title: "DataForSEO 잔액(SEO·GEO 유료 수집)", run: () => checkDataForSeo() },
  { key: "serpapi", title: "SerpApi 한도(네이버 AI 브리핑)", run: () => checkSerpApi() },
  { key: "crons", title: "크론(자동 작업) 실행", run: (ctx) => checkCrons(ctx) },
  { key: "geo", title: "GEO(AI 답변 노출 추적)", run: (ctx) => checkGeo(ctx) },
  { key: "seo", title: "SEO 진단", run: (ctx) => checkSeo(ctx) },
  { key: "ads", title: "네이버 검색광고", run: (ctx) => checkAds(ctx) },
  { key: "pipeline", title: "콘텐츠 자동화(블로그·카페)", run: (ctx) => checkPipeline(ctx) },
  { key: "cost", title: "이번 달 AI·데이터 비용", run: (ctx) => checkCost(ctx) },
];

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("check_timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export async function runChecks(ctx: CheckContext, checks: Named[] = DEFAULT_CHECKS): Promise<CheckResult[]> {
  const settled = await Promise.allSettled(checks.map((c) => withTimeout(c.run(ctx), CHECK_TIMEOUT_MS)));
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          key: checks[i].key,
          title: checks[i].title,
          level: "error" as const,
          summary: `점검 실패(${s.reason instanceof Error && s.reason.message === "check_timeout" ? "시간 초과" : "내부 오류"}) — 상태를 확인하지 못했습니다.`,
          lines: [],
        },
  );
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const kstClock = (at: Date) => new Date(at.getTime() + 9 * 3600000).toISOString().slice(11, 16);

export function formatReport(results: CheckResult[], now: Date): { subject: string; text: string; kstDay: string } {
  const kstDay = kstDate(now);
  const weekday = WEEKDAY[new Date(`${kstDay}T00:00:00Z`).getUTCDay()];
  const errors = results.filter((r) => r.level === "error").length;
  const warns = results.filter((r) => r.level === "warn").length;
  const verdict = errors ? `이상 ${errors}${warns ? ` · 주의 ${warns}` : ""}` : warns ? `주의 ${warns}` : "정상";
  const subject = `[MINTEQ 운영] ${kstDay.slice(5).replace("-", "/")}(${weekday}) ${verdict}`;
  const order = { error: 0, warn: 1, ok: 2, info: 3 } as const;
  const sorted = [...results].sort((a, b) => order[a.level] - order[b.level]);
  const body = sorted.map((r) => [`${LEVEL_MARK[r.level]} ${r.title}`, `  ${r.summary}`, ...r.lines.map((l) => `  - ${l}`)].join("\n"));
  const text = [
    `MINTEQ 운영 아침 보고서 — ${kstDay}(${weekday}) ${kstClock(now)} KST 기준`,
    `요약: ${verdict}`,
    "",
    body.join("\n\n"),
    "",
    "대시보드: https://m-master.vercel.app",
  ].join("\n");
  return { subject, text, kstDay };
}
