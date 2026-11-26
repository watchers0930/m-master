// lib/ops/report/send.ts — 아침 보고서 하루 1통 발송.
// - 수신자 = env OPS_REPORT_EMAILS만(대장 결정 2026-11-26: 매일 아침 대장 수신). 보고서에 모든 소유자의 비용·이메일·광고 계정이 실리므로
//   플랫폼 운영자 전용이다 — 광고 알림 수신자(ADS_ALERT_EMAILS)로 대신 보내지 않는다(codex HIGH: 테넌트 정보 유출).
// - 하루 1통: 크론이 08:00·08:30 두 번 돈다(첫 발송 실패 재시도). 발송 성공은 audit_log(ops.report.sent, targetId=KST 날짜)에
//   남기고 다음 실행은 그 기록이 있으면 보내지 않는다. 기록 직전에 죽어도 Resend Idempotency-Key(ops-report-날짜, 24시간)가 중복을 막는다.
// - DB 구조 변경 없음(기존 audit_log 사용).
import { prisma } from "@/lib/prisma";
import { emailConfigured, EmailError, recipientsFrom, sendEmail, type EmailTransport } from "@/lib/notify/email";
import { formatReport, runChecks } from "./build";

export const OPS_REPORT_ACTION = "ops.report.sent";
const MAX_RECIPIENTS = 10;

/** 고정 코드를 가진 오류(크론 실행 기록에 사유로 남는다 — heartbeat outcomeOf가 code를 읽는다). */
function reportError(code: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(code, cause === undefined ? undefined : { cause }), { code });
}

export function reportRecipients(): string[] {
  return recipientsFrom(process.env.OPS_REPORT_EMAILS, MAX_RECIPIENTS);
}

export type SendReportResult =
  | { status: "sent"; kstDay: string; subject: string }
  | { status: "already_sent"; kstDay: string };

export async function sendDailyReport(options: { now?: Date; transport?: EmailTransport; runChecks?: typeof runChecks } = {}): Promise<SendReportResult> {
  const now = options.now ?? new Date();
  const { kstDay } = formatReport([], now);
  const already = await prisma.auditLog.findFirst({
    where: { action: OPS_REPORT_ACTION, targetType: "ops_report", targetId: kstDay },
    select: { id: true },
  });
  if (already) return { status: "already_sent", kstDay };
  const to = reportRecipients();
  // 설정 누락은 조용히 넘기지 않는다(200이면 매일 안 보내도 신호가 없다 — codex MED) → 크론 실패로 기록된다.
  if (!emailConfigured() || !to.length) throw reportError("ops_report_not_configured");

  const results = await (options.runChecks ?? runChecks)({ now });
  const report = formatReport(results, now);
  try {
    await sendEmail({ to, subject: report.subject, text: report.text }, { transport: options.transport, idempotencyKey: `ops-report-${kstDay}` });
  } catch (error) {
    // 409(같은 키로 진행 중·이미 보냄)도 발송 증거가 아니다 — 앞 요청이 결국 실패할 수 있다(codex HIGH). 기록하지 않고 실패로 둔다.
    // 고정 코드만 밖으로(원문·키 없음). 크론 실행 기록에 실패로 남고 30분 뒤 실행이 다시 시도한다(같은 키라 중복 메일은 Resend가 막는다).
    throw reportError(error instanceof EmailError ? `ops_report_${error.code}` : "ops_report_send_failed", error);
  }
  // 기록 실패를 삼키지 않는다(삼키면 다음 실행이 '안 보냄'으로 알고 다시 보낸다 — codex MED). 실패하면 크론 실패로 드러난다.
  await prisma.auditLog.create({
    data: {
      actor: null,
      action: OPS_REPORT_ACTION,
      targetType: "ops_report",
      targetId: kstDay,
      payload: { subject: report.subject, levels: results.map((r) => `${r.key}:${r.level}`) },
    },
  });
  return { status: "sent", kstDay, subject: report.subject };
}
