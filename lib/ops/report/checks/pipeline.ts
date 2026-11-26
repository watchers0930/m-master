// lib/ops/report/checks/pipeline.ts — 콘텐츠 자동화: 스위치·발행 작업자 설정·최근 생성·마지막 발행(참고 정보).
// 발행은 대장 결정(2026-11-26)으로 정지 상태가 정상이라 판정은 '참고'. 실패 슬롯만 주의로 올린다.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-time";
import { automationEnabled } from "@/lib/pipeline/automation";
import { ago, type CheckContext, type CheckResult } from "../types";

type Row = { drafts24: number; last_created: Date | null; last_published: Date | null; failed7: number };

export async function checkPipeline({ now }: CheckContext, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<CheckResult> {
  const base = { key: "pipeline", title: "콘텐츠 자동화(블로그·카페)" };
  const day = new Date(now.getTime() - 864e5), week = new Date(now.getTime() - 7 * 864e5);
  const [r] = await db.$queryRaw<Row[]>`
    SELECT
      (SELECT count(*) FROM contents WHERE created_at >= ${utcTimestamp(day)})::int AS drafts24,
      (SELECT max(created_at) FROM contents) AS last_created,
      (SELECT max(published_at) FROM schedule_slots) AS last_published,
      (SELECT count(*) FROM schedule_slots WHERE status = 'failed' AND scheduled_at >= ${utcTimestamp(week)})::int AS failed7`;
  const workerOwners = (process.env.BLOG_PUBLISH_OWNER_IDS ?? "").split(",").filter((s) => s.trim()).length;
  const lines = [
    `자동화 스위치 ${automationEnabled() ? "켜짐(초안 생성·발행 크론 동작)" : "꺼짐"} · 블로그 발행 작업자 ${workerOwners ? `${workerOwners}명 설정` : "미설정(발행 안 함)"}`,
    `최근 24시간 생성 ${r.drafts24}건(마지막 ${ago(r.last_created, now)}) · 마지막 발행 ${ago(r.last_published, now)}`,
  ];
  if (r.failed7 > 0) return { ...base, level: "warn", summary: `최근 7일 발행 실패 ${r.failed7}건`, lines };
  return { ...base, level: "info", summary: workerOwners ? "발행 설정됨" : "발행 정지 상태", lines };
}
