import { logger } from "../logger";

export type AlertSeverity = "info" | "warning" | "critical";

type OperationsAlertParams = {
  severity: AlertSeverity;
  title: string;
  projectId?: string | null;
  projectName?: string | null;
  executionSource?: string | null;
  lines: string[];
  webhookUrl?: string | null;
};

function getWebhookUrl() {
  return process.env.OPERATIONS_ALERT_WEBHOOK_URL?.trim() || "";
}

function formatAlert(params: OperationsAlertParams) {
  const header = `[${params.severity.toUpperCase()}] ${params.title}`;
  const meta = [
    params.projectName ? `project=${params.projectName}` : "",
    params.projectId ? `projectId=${params.projectId}` : "",
    params.executionSource ? `source=${params.executionSource}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return [header, meta, ...params.lines].filter(Boolean).join("\n");
}

export async function sendOperationsAlert(params: OperationsAlertParams) {
  const webhookUrl = params.webhookUrl?.trim() || getWebhookUrl();

  if (!webhookUrl) {
    return false;
  }

  const text = formatAlert(params);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      logger.error("operations_alert.send.failed", {
        status: response.status,
        detail,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error("operations_alert.send.error", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return false;
  }
}
