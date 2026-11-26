// lib/cron/schedule.ts — 크론별 '이만큼 넘게 실행 기록이 없으면 멈춤' 기준(분). vercel.json 일정과 1:1(테스트가 대조한다).
// 기준 = 주기 + 여유(놓침 1~2회 허용). ops-report도 포함한다(어제 보고서가 실패했으면 오늘 보고서에 드러난다).
// '기록 없음'의 유예 기준은 고정 날짜가 아니라 실행 기록이 처음 생긴 시각이다(checks/crons.ts — codex MED).
export interface CronExpectation { label: string; maxGapMinutes: number }

export const CRON_EXPECTATIONS: Record<string, CronExpectation> = {
  "ads-guard": { label: "광고 지출 감시(30분)", maxGapMinutes: 90 },
  "ads-inspect": { label: "광고 심사 동기화(30분)", maxGapMinutes: 90 },
  "ads-stats": { label: "광고 성과 수집(매일 06시)", maxGapMinutes: 26 * 60 },
  "seo-resume": { label: "SEO 결과 수거(15분)", maxGapMinutes: 60 },
  "schedule-publish": { label: "예약 발행(15분)", maxGapMinutes: 60 },
  "content-generate": { label: "초안 생성(매일 09~11시)", maxGapMinutes: 28 * 60 },
  "visibility-track": { label: "GEO 수집(매일 09시)", maxGapMinutes: 26 * 60 },
  "strategy-refresh": { label: "주간 전략(월요일 새벽 KST)", maxGapMinutes: 8 * 24 * 60 },
  "topics-refresh": { label: "주간 토픽(월요일 아침 KST)", maxGapMinutes: 8 * 24 * 60 },
  "ops-report": { label: "운영 아침 보고서(매일 08시)", maxGapMinutes: 26 * 60 },
};
