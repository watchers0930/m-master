// lib/ads/alerts.ts — 광고 감시 알림 큐(ad_alerts)와 발송. 같은 (계정, 유형, KST 날짜, dedupeKey)는 1회만.
// - dedupeKey(판정 Task 11 I-3, 기본 ''): 같은 날 별개 사건을 구분한다 — pause_failed·drift·inspect_denied = 엔티티 naverId, guard_blind = 사유.
//   cap_90·cap_100·auto_resume·bizmoney_low·key_invalid는 ''(하루 1회).
// - flushAlerts는 안전 유형(SAFETY_FIRST: pause_failed·cap_100·guard_blind·drift)을 먼저, 그다음 나머지를 오래된 순으로 보낸다.
// - queueAlert: ownerId는 항상 AdAccount 행에서 읽는다(호출자 값 금지). 중복 요청은 첫 행을 그대로 둔다(sentAt·attempts·payload 유지).
// - flushAlerts: 오래된 순으로 limit건. 각 행은 조건부 updateMany로 먼저 "잡고"(claim) 잡은 실행만 보낸다 → 동시 크론도 1회 발송.
//   · claim = claimedAt 기록 + attempts+1. 시도 상한 MAX_ATTEMPTS(5) — 발송 직전에 죽은 실행도 1회로 센다(무한 재시도 방지).
//   · 죽은 실행이 남긴 claim은 CLAIM_TIMEOUT_MS(5분) 뒤 다시 잡을 수 있다. 근거: 1통 발송 상한 10초(SEND_TIMEOUT_MS) + DB 왕복 ≪ 5분,
//     감시 크론은 30분 주기라 다음 실행에서 회수된다. 회수 후 재발송도 Idempotency-Key(=알림 id)라 Resend가 중복 메일을 막는다(24시간).
//   · 발송 설정 없음(email_not_configured: 키·발신·수신 env)은 claim하지 않는다 → attempts를 쓰지 않고 대기열에 남는다.
// - 수신자 = env ADS_ALERT_EMAILS(쉼표 구분, trim, 주소 검증, 대소문자 무시 중복 제거, 최대 10개). 무효 항목은 버린다.
//   유효 주소가 하나도 없으면 RESEND_API_KEY·ADS_ALERT_FROM 누락과 같이 email_not_configured로 대기(시도 미차감).
// - payload 규칙은 alert-format.ts 머리말 참고(비밀값 금지).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EmailError, emailConfigured, isDeliverableEmail, sendEmail, type EmailTransport } from "@/lib/notify/email";
import { formatAlertEmail, isAdAlertType, validateAlertPayload, type AdAlertType, type AlertPayload } from "./alert-format";

export { ALERT_TYPES, type AdAlertType, type AlertPayload } from "./alert-format";

export const MAX_ATTEMPTS = 5;
export const CLAIM_TIMEOUT_MS = 5 * 60_000;
export const MAX_FLUSH_LIMIT = 100;
export const MAX_ALERT_RECIPIENTS = 10;
const KST_OFFSET_MS = 9 * 60 * 60_000;

type Clock = () => Date;
export type QueueOptions = { now?: Clock; dedupeKey?: string };
export const SAFETY_FIRST: readonly AdAlertType[] = ["ads.pause_failed", "ads.cap_100", "ads.guard_blind", "ads.drift"];
const MAX_DEDUPE_KEY_CHARS = 200;
export type FlushOptions = { now?: Clock; transport?: EmailTransport };
export type FlushResult = { sent: number; failed: number };

/** KST(UTC+9, 서머타임 없음) 날짜 'YYYY-MM-DD'. 서버 시간대와 무관하게 UTC 산술로 계산한다. */
export function kstDate(at: Date): string {
  const ms = at.getTime();
  if (!Number.isFinite(ms)) throw new Error("invalid_date");
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 그 시각이 속한 KST 날짜의 0시(UTC Date). 감시 재개(guard-resume)·오늘 비용(spend)이 같이 쓴다. */
export function kstDayStart(now: Date): Date {
  return new Date(Date.parse(`${kstDate(now)}T00:00:00Z`) - KST_OFFSET_MS);
}

export async function queueAlert(accountId: string, type: AdAlertType, payload: AlertPayload, options: QueueOptions = {}): Promise<void> {
  if (typeof accountId !== "string" || !accountId) throw new Error("ad_account_not_found");
  if (!isAdAlertType(type)) throw new Error("invalid_alert_type");
  const data = validateAlertPayload(payload);
  const account = await prisma.adAccount.findUnique({ where: { id: accountId }, select: { ownerId: true } });
  if (!account) throw new Error("ad_account_not_found");
  const day = kstDate((options.now ?? (() => new Date()))());
  const dedupeKey = options.dedupeKey ?? "";
  if (typeof dedupeKey !== "string" || dedupeKey.length > MAX_DEDUPE_KEY_CHARS) throw new Error("invalid_dedupe_key");
  try {
    await prisma.adAlert.upsert({
      where: { adAccountId_type_kstDate_dedupeKey: { adAccountId: accountId, type, kstDate: day, dedupeKey } },
      create: { ownerId: account.ownerId, adAccountId: accountId, type, kstDate: day, dedupeKey, payload: data },
      update: {}, // 중복: 아무것도 바꾸지 않는다(이미 보낸 알림을 되살리지 않음)
    });
  } catch (error) {
    // 동시 upsert 경합으로 다른 요청이 먼저 만들었다 = 목적 달성
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

/** ADS_ALERT_EMAILS → 유효 주소 목록(순서 유지, 중복 제거, 최대 10개). 없거나 전부 무효면 []. */
export function alertRecipients(): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of (process.env.ADS_ALERT_EMAILS ?? "").split(",")) {
    const addr = raw.trim();
    if (!isDeliverableEmail(addr) || seen.has(addr.toLowerCase())) continue;
    seen.add(addr.toLowerCase());
    out.push(addr);
    if (out.length === MAX_ALERT_RECIPIENTS) break;
  }
  return out;
}

function failureCode(error: unknown): string {
  return error instanceof EmailError ? error.code : "send_failed"; // 고정 코드만 저장(원문 메시지·키 금지)
}

export async function flushAlerts(limit = 20, options: FlushOptions = {}): Promise<FlushResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FLUSH_LIMIT) throw new Error("invalid_limit");
  const now = options.now ?? (() => new Date());
  const staleBefore = new Date(now().getTime() - CLAIM_TIMEOUT_MS);
  const claimable: Prisma.AdAlertWhereInput = {
    sentAt: null,
    attempts: { lt: MAX_ATTEMPTS },
    OR: [{ claimedAt: null }, { claimedAt: { lte: staleBefore } }],
  };
  const select = {
    id: true, type: true, kstDate: true, payload: true, attempts: true, claimedAt: true,
    adAccount: { select: { label: true } },
  } as const;
  const orderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const first = await prisma.adAlert.findMany({ where: { AND: [claimable, { type: { in: [...SAFETY_FIRST] } }] }, orderBy, take: limit, select });
  const rest = first.length < limit
    ? await prisma.adAlert.findMany({ where: { AND: [claimable, { type: { notIn: [...SAFETY_FIRST] } }] }, orderBy, take: limit - first.length, select })
    : [];
  const due = [...first, ...rest];
  if (!due.length) return { sent: 0, failed: 0 };

  const to = alertRecipients();
  if (!emailConfigured() || !to.length) {
    await prisma.adAlert.updateMany({ where: { AND: [claimable, { id: { in: due.map((a) => a.id) } }] }, data: { lastError: "email_not_configured" } });
    return { sent: 0, failed: due.length };
  }

  let sent = 0, failed = 0;
  for (const alert of due) {
    const observed = { id: alert.id, sentAt: null, attempts: alert.attempts, claimedAt: alert.claimedAt };
    const claimedAt = now();
    const claim = await prisma.adAlert.updateMany({ where: observed, data: { claimedAt, attempts: { increment: 1 } } });
    if (claim.count !== 1) continue; // 다른 실행이 먼저 잡았거나 이미 보냄 — 이 실행의 몫이 아니다

    try {
      await sendEmail({ to, ...formatAlertEmail({ type: alert.type, kstDate: alert.kstDate, accountLabel: alert.adAccount.label, payload: alert.payload }) }, {
        transport: options.transport,
        idempotencyKey: alert.id,
      });
    } catch (error) {
      const code = failureCode(error);
      await prisma.adAlert.updateMany({
        where: { id: alert.id, sentAt: null, claimedAt },
        // 설정 누락은 시도로 세지 않는다(발송 도중 env가 사라진 경우)
        data: { claimedAt: null, lastError: code, ...(code === "email_not_configured" ? { attempts: { decrement: 1 } } : {}) },
      });
      failed++;
      continue;
    }
    // 이 갱신이 실패해도 claim이 남아 5분 뒤 같은 Idempotency-Key로 재시도된다 → Resend가 중복 메일을 막는다.
    await prisma.adAlert.updateMany({ where: { id: alert.id, sentAt: null }, data: { sentAt: now(), claimedAt: null, lastError: null } });
    sent++;
  }
  return { sent, failed };
}
