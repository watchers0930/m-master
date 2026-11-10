// lib/ads/alert-format.ts — 광고 알림 유형 목록과 메일 문안(한국어 일반 텍스트). DB·발송과 무관한 순수 함수.
// payload 규칙(호출자 필독): 내부 코드가 만든 값만 넣는다. 키·비밀값·토큰·전체 API 키는 절대 넣지 않는다
// (비밀처럼 보이는 키 이름은 validateAlertPayload가 거부). 금액은 숫자(원)로 넣으면 천 단위 구분해 보여 준다.
import type { Prisma } from "@prisma/client";

export const ALERT_TYPES = [
  "ads.key_invalid",
  "ads.cap_90",
  "ads.cap_100",
  "ads.auto_resume",
  "ads.drift",
  "ads.inspect_denied",
  "ads.bizmoney_low",
  // 안전 끄기 실패·켜기 경합(Task 9 판정 round 2). 별도 유형이라 같은 날 ads.drift가 있어도 중복 제거에 묻히지 않는다.
  "ads.pause_failed",
] as const;
export type AdAlertType = (typeof ALERT_TYPES)[number];
export type AlertPayload = Prisma.InputJsonObject;

export const MAX_PAYLOAD_JSON_CHARS = 4_000;
const SECRET_KEY_NAME = /secret|password|passwd|token|api[_-]?key|authorization|credential|signature/i;
const MAX_LINES = 30;
const MAX_VALUE_CHARS = 200;

const TITLES: Readonly<Record<AdAlertType, string>> = {
  "ads.key_invalid": "네이버 광고 API 키가 무효입니다 — 감시·적용을 멈췄습니다",
  "ads.cap_90": "하루 광고비 상한 90% 도달",
  "ads.cap_100": "하루 광고비 상한 100% 도달 — 캠페인을 일시중지했습니다",
  "ads.auto_resume": "날짜가 바뀌어 상한으로 멈춘 캠페인을 다시 켰습니다",
  "ads.drift": "네이버 설정이 MINTEQ 기록과 다릅니다",
  "ads.inspect_denied": "광고 검수가 반려되었습니다",
  "ads.bizmoney_low": "비즈머니 잔액이 부족합니다",
  "ads.pause_failed": "광고를 자동으로 끄지 못했거나 꺼졌는지 확인하지 못했습니다 — 네이버 광고 화면에서 지금 바로 직접 꺼 주세요",
};

export function isAdAlertType(value: unknown): value is AdAlertType {
  return typeof value === "string" && (ALERT_TYPES as readonly string[]).includes(value);
}

/** 저장 전 검사: 일반 객체, 비밀처럼 보이는 키 없음, JSON 4,000자 이하. 통과하면 그대로 돌려준다. */
export function validateAlertPayload(payload: unknown): AlertPayload {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_alert_payload");
  let json: string;
  try {
    json = JSON.stringify(payload, (key, value) => {
      if (key && SECRET_KEY_NAME.test(key)) throw new Error("alert_payload_forbidden_key");
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "alert_payload_forbidden_key") throw error;
    throw new Error("invalid_alert_payload", { cause: error }); // 순환 참조·BigInt 등
  }
  if (json.length > MAX_PAYLOAD_JSON_CHARS) throw new Error("alert_payload_too_large");
  return JSON.parse(json) as AlertPayload;
}

function showValue(value: unknown): string {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? value.toLocaleString("ko-KR")
      : typeof value === "string"
        ? value
        : JSON.stringify(value) ?? "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_VALUE_CHARS ? oneLine.slice(0, MAX_VALUE_CHARS - 1) + "…" : oneLine;
}

export type AlertMailInput = { type: string; kstDate: string; accountLabel: string; payload: unknown };

/** 제목·본문을 만든다. 최종 CR/LF 제거와 길이 제한은 sendEmail이 한 번 더 한다. */
export function formatAlertEmail(input: AlertMailInput): { subject: string; text: string } {
  const title = isAdAlertType(input.type) ? TITLES[input.type] : "광고 알림";
  const label = showValue(input.accountLabel);
  const lines = [title, "", `계정: ${label}`, `날짜(KST): ${input.kstDate}`];
  const payload = input.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const entries = Object.entries(payload as Record<string, unknown>).slice(0, MAX_LINES);
    if (entries.length) lines.push("", "상세", ...entries.map(([k, v]) => `- ${showValue(k)}: ${showValue(v)}`));
  }
  lines.push("", "MINTEQ 광고 관리 화면에서 확인해 주세요.", "이 메일은 같은 계정·유형에 대해 하루(KST) 한 번만 보냅니다.");
  return { subject: `[MINTEQ 광고] ${title} (${label})`, text: lines.join("\n") };
}
