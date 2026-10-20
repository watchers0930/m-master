/** DTO allowlist: persisted codes and unexpected debug text never reach clients. */
const messages: Record<string, string> = {
  submission_uncertain:
    "작업 접수 여부를 확인하고 있습니다. 추가 요청 없이 확인을 기다려 주세요.",
  result_reconciliation_required:
    "수집 결과를 확인하고 있습니다. 확인이 완료되면 결과를 안내합니다.",
};
const publicMessages = new Set([
  ...Object.values(messages),
  "실행하지 않은 진단 예약이 만료되었습니다. 새 진단을 시작해 주세요.",
  "결과 확인 대기 중입니다.",
  "저장 결과 반영 대기 중입니다.",
  "외부 수집에 실패했습니다.",
  "일부 URL 수집에 실패했습니다.",
  "예산 또는 실행 조건으로 자동 순위 수집을 생략했습니다.",
  "지원이 확인되지 않은 작업입니다.",
  "키워드 한도로 순위 수집을 보류했습니다.",
  "과금 대조 및 복구가 필요한 작업이 있습니다.",
  "일부 수집이 실패했거나 지원되지 않습니다.",
]);
export function publicFailReason(reason: string | null, status: string) {
  if (!reason || status === "completed") return null;
  if (Object.hasOwn(messages, reason)) return messages[reason];
  if (publicMessages.has(reason)) return reason;
  if (status === "uncertain") return messages.submission_uncertain;
  if (status === "pending" || status === "claimed" || status === "submitted")
    return "결과 확인 대기 중입니다.";
  return "일부 수집이 실패했거나 지원되지 않습니다.";
}
