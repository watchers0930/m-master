// lib/notify/email.ts — Resend REST API로 일반 텍스트 메일 1통을 보낸다(SDK 의존성 없이 fetch).
// - env: RESEND_API_KEY(비밀), ADS_ALERT_FROM(검증된 발신 주소). 둘 중 하나라도 비면 'email_not_configured'로 throw.
// - 에러는 고정 코드(EmailError.code = message)만 담는다. API 키·응답 본문·원래 에러(cause)는 절대 싣지 않는다.
// - 제목은 CR/LF·제어문자를 공백으로 바꾸고(헤더 주입 차단) 길이를 자른다. 본문도 제어문자를 지우고 길이를 자른다.
// - idempotencyKey를 주면 Idempotency-Key 헤더로 보낸다. 응답을 잃은 재시도가 두 번째 메일이 되지 않게 한다(Resend는 24시간 보관).

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const SEND_TIMEOUT_MS = 10_000;
export const MAX_SUBJECT_CHARS = 150;
export const MAX_TEXT_CHARS = 8_000;
const MAX_IDEMPOTENCY_KEY_CHARS = 256;

export type EmailErrorCode =
  | "email_not_configured"
  | "invalid_recipient"
  | "invalid_idempotency_key"
  | "resend_timeout"
  | "resend_network"
  | `resend_http_${number}`;

export class EmailError extends Error {
  readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode) {
    super(code);
    this.name = "EmailError";
    this.code = code;
  }
}

/** fetch와 같은 모양. 테스트는 가짜를 주입한다. */
export type EmailTransport = (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>;

export type EmailMessage = { to: string; subject: string; text: string };
export type SendOptions = { transport?: EmailTransport; idempotencyKey?: string };

// 단일 주소만. 공백·쉼표·꺾쇠·제어문자가 없어야 한다(여러 수신자·헤더 주입 차단).
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const EMAIL_RE = /^[^\s@,;<>"'()\\\x00-\x1f\x7f]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
// 제목: 모든 제어문자 + 유니코드 줄/문단 구분자 → 공백
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const SUBJECT_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
// 본문: \n은 남기고 나머지 제어문자는 지운다(\r\n → \n)
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const TEXT_UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

export function isDeliverableEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value);
}

export function sanitizeSubject(subject: string): string {
  return truncate(String(subject).replace(SUBJECT_UNSAFE, " ").replace(/ {2,}/g, " ").trim(), MAX_SUBJECT_CHARS);
}

export function sanitizeText(text: string): string {
  return truncate(String(text).replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n").replace(TEXT_UNSAFE, ""), MAX_TEXT_CHARS);
}

function truncate(value: string, max: number): string {
  const chars = Array.from(value); // 서로게이트 쌍을 자르지 않는다
  return chars.length <= max ? value : chars.slice(0, max - 1).join("") + "…";
}

/** 발송 설정이 갖춰졌는지(값 자체는 돌려주지 않는다). */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.ADS_ALERT_FROM?.trim());
}

export async function sendEmail(message: EmailMessage, options: SendOptions = {}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ADS_ALERT_FROM?.trim();
  if (!apiKey || !from) throw new EmailError("email_not_configured");
  if (!isDeliverableEmail(message.to)) throw new EmailError("invalid_recipient");
  const key = options.idempotencyKey;
  if (key !== undefined && (!key || key.length > MAX_IDEMPOTENCY_KEY_CHARS || !/^[\x21-\x7e]+$/.test(key))) {
    throw new EmailError("invalid_idempotency_key");
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  const body = JSON.stringify({ from, to: [message.to], subject: sanitizeSubject(message.subject), text: sanitizeText(message.text) });
  const transport: EmailTransport = options.transport ?? ((url, init) => fetch(url, init));

  let response: Response;
  try {
    response = await transport(RESEND_ENDPOINT, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  } catch (error) {
    // 원래 에러는 버린다 — 메시지·cause에 요청 헤더(키)가 섞여 있을 수 있다.
    const name = error instanceof Error ? error.name : "";
    throw new EmailError(name === "TimeoutError" || name === "AbortError" ? "resend_timeout" : "resend_network");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined); // 본문은 읽지도 남기지도 않는다
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;
    throw new EmailError(`resend_http_${status}`);
  }
  await response.body?.cancel().catch(() => undefined);
}
