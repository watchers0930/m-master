type LogLevel = "info" | "error";

function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    ...meta,
  };

  if (level === "error") {
    console.error(payload);
    return;
  }

  console.info(payload);
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    writeLog("info", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    writeLog("error", message, meta);
  },
};
