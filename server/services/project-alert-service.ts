import { getProjectDetail } from "../repositories/project-repository";
import { decryptSecret } from "./credential-vault-service";
import { sendOperationsAlert, type AlertSeverity } from "./operations-alert-service";

type ProjectAlertCategory = "failure" | "needs_review" | "blocked" | "info";

type ProjectAlertRequest = {
  projectId: string;
  severity: AlertSeverity;
  category: ProjectAlertCategory;
  title: string;
  executionSource?: string | null;
  lines: string[];
};

function normalizePolicyMode(value?: string | null) {
  if (!value) {
    return "failures-and-review";
  }

  if (
    value === "disabled" ||
    value === "all" ||
    value === "critical-only" ||
    value === "failures-only" ||
    value === "failures-and-review"
  ) {
    return value;
  }

  return "failures-and-review";
}

function parseClockMinutes(value?: string | null) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function getMinutesInTimezone(timeZone?: string | null) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hour = Number(parts.find((item) => item.type === "hour")?.value || "0");
  const minute = Number(parts.find((item) => item.type === "minute")?.value || "0");
  return hour * 60 + minute;
}

function isQuietHours(nowMinutes: number, startMinutes: number, endMinutes: number) {
  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function shouldSendByPolicy(params: {
  mode: string;
  severity: AlertSeverity;
  category: ProjectAlertCategory;
  quietStart?: string | null;
  quietEnd?: string | null;
  timeZone?: string | null;
}) {
  if (params.mode === "disabled") {
    return false;
  }

  if (params.severity !== "critical") {
    const startMinutes = parseClockMinutes(params.quietStart);
    const endMinutes = parseClockMinutes(params.quietEnd);
    if (startMinutes != null && endMinutes != null) {
      const nowMinutes = getMinutesInTimezone(params.timeZone);
      if (isQuietHours(nowMinutes, startMinutes, endMinutes)) {
        return false;
      }
    }
  }

  if (params.mode === "all") {
    return true;
  }

  if (params.mode === "critical-only") {
    return params.severity === "critical";
  }

  if (params.mode === "failures-only") {
    return params.category === "failure" || params.category === "blocked";
  }

  return params.category === "failure" || params.category === "blocked" || params.category === "needs_review";
}

export async function sendProjectOperationsAlert(params: ProjectAlertRequest) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    return false;
  }

  const mode = normalizePolicyMode(record.project.alertPolicyMode);
  if (params.category === "blocked" && !record.project.alertOnBlockedReadiness) {
    return false;
  }
  const allowed =
    shouldSendByPolicy({
      mode,
      severity: params.severity,
      category: params.category,
      quietStart: record.project.alertQuietHoursStart,
      quietEnd: record.project.alertQuietHoursEnd,
      timeZone: record.project.alertTimezone,
    });

  if (!allowed) {
    return false;
  }

  const webhookUrl =
    decryptSecret(record.project.operationsAlertWebhookEncrypted)?.trim() ||
    process.env.OPERATIONS_ALERT_WEBHOOK_URL?.trim() ||
    "";

  if (!webhookUrl) {
    return false;
  }

  return sendOperationsAlert({
    severity: params.severity,
    title: params.title,
    projectId: record.project.id,
    projectName: record.project.name,
    executionSource: params.executionSource,
    lines: params.lines,
    webhookUrl,
  });
}

export async function sendProjectOperationsAlertTest(params: {
  projectId: string;
  actorLabel?: string | null;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    return false;
  }

  const webhookUrl =
    decryptSecret(record.project.operationsAlertWebhookEncrypted)?.trim() ||
    process.env.OPERATIONS_ALERT_WEBHOOK_URL?.trim() ||
    "";

  if (!webhookUrl) {
    return false;
  }

  return sendOperationsAlert({
    severity: "info",
    title: "운영 알림 테스트",
    projectId: record.project.id,
    projectName: record.project.name,
    executionSource: "dashboard",
    lines: [
      "프로젝트 운영 알림 채널 연결 테스트입니다.",
      params.actorLabel ? `actor=${params.actorLabel}` : "actor=system",
    ],
    webhookUrl,
  });
}
