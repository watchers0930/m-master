// lib/ads/alerts.ts — 광고 감시 알림 큐(ad_alerts)와 발송. 같은 (계정, 유형, KST 날짜)는 1회만.
// - queueAlert: ownerId는 항상 AdAccount 행에서 읽는다(호출자 값 금지). 중복 요청은 첫 행을 그대로 둔다(sentAt·attempts·payload 유지).
// - flushAlerts: 오래된 순으로 limit건. 각 행은 조건부 updateMany로 먼저 "잡고"(claim) 잡은 실행만 보낸다 → 동시 크론도 1회 발송.
//   · claim = claimedAt 기록 + attempts+1. 시도 상한 MAX_ATTEMPTS(5) — 발송 직전에 죽은 실행도 1회로 센다(무한 재시도 방지).
//   · 죽은 실행이 남긴 claim은 CLAIM_TIMEOUT_MS(5분) 뒤 다시 잡을 수 있다. 근거: 1통 발송 상한 10초(SEND_TIMEOUT_MS) + DB 왕복 ≪ 5분,
//     감시 크론은 30분 주기라 다음 실행에서 회수된다. 회수 후 재발송도 Idempotency-Key(=알림 id)라 Resend가 중복 메일을 막는다(24시간).
//   · 발송 설정 없음(email_not_configured)·수신자 없음(no_recipient)은 claim하지 않는다 → attempts를 쓰지 않고 대기열에 남는다.
// - 수신자 = 계정 소유자의 User.email(행마다 조회하지 않고 relation select로 flush당 일괄 조회).
// - payload 규칙은 alert-format.ts 머리말 참고(비밀값 금지).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EmailError, emailConfigured, isDeliverableEmail, sendEmail, type EmailTransport } from "@/lib/notify/email";
import { formatAlertEmail, isAdAlertType, validateAlertPayload, type AdAlertType, type AlertPayload } from "./alert-format";

export { ALERT_TYPES, type AdAlertType, type AlertPayload } from "./alert-format";

export const MAX_ATTEMPTS = 5;
export const CLAIM_TIMEOUT_MS = 5 * 60_000;
export const MAX_FLUSH_LIMIT = 100;
const KST_OFFSET_MS = 9 * 60 * 60_000;

type Clock = () => Date;
export type QueueOptions = { now?: Clock };
export type FlushOptions = { now?: Clock; transport?: EmailTransport };
export type FlushResult = { sent: number; failed: number };

/** KST(UTC+9, 서머타임 없음) 날짜 'YYYY-MM-DD'. 서버 시간대와 무관하게 UTC 산술로 계산한다. */
export function kstDate(at: Date): string {
  const ms = at.getTime();
  if (!Number.isFinite(ms)) throw new Error("invalid_date");
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function queueAlert(accountId: string, type: AdAlertType, payload: AlertPayload, options: QueueOptions = {}): Promise<void> {
  if (typeof accountId !== "string" || !accountId) throw new Error("ad_account_not_found");
  if (!isAdAlertType(type)) throw new Error("invalid_alert_type");
  const data = validateAlertPayload(payload);
  const account = await prisma.adAccount.findUnique({ where: { id: accountId }, select: { ownerId: true } });
  if (!account) throw new Error("ad_account_not_found");
  const day = kstDate((options.now ?? (() => new Date()))());
  try {
    await prisma.adAlert.upsert({
      where: { adAccountId_type_kstDate: { adAccountId: accountId, type, kstDate: day } },
      create: { ownerId: account.ownerId, adAccountId: accountId, type, kstDate: day, payload: data },
      update: {}, // 중복: 아무것도 바꾸지 않는다(이미 보낸 알림을 되살리지 않음)
    });
  } catch (error) {
    // 동시 upsert 경합으로 다른 요청이 먼저 만들었다 = 목적 달성
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
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
  const due = await prisma.adAlert.findMany({
    where: claimable,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true, type: true, kstDate: true, payload: true, attempts: true, claimedAt: true,
      owner: { select: { email: true } },
      adAccount: { select: { label: true } },
    },
  });
  if (!due.length) return { sent: 0, failed: 0 };

  if (!emailConfigured()) {
    await prisma.adAlert.updateMany({ where: { AND: [claimable, { id: { in: due.map((a) => a.id) } }] }, data: { lastError: "email_not_configured" } });
    return { sent: 0, failed: due.length };
  }

  let sent = 0, failed = 0;
  for (const alert of due) {
    const observed = { id: alert.id, sentAt: null, attempts: alert.attempts, claimedAt: alert.claimedAt };
    const to = alert.owner.email;
    if (!isDeliverableEmail(to)) {
      await prisma.adAlert.updateMany({ where: observed, data: { lastError: "no_recipient" } });
      failed++;
      continue;
    }
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
