// lib/ads/names.ts — 적용(apply)이 네이버에 만드는 캠페인·광고그룹의 결정적 이름(단일 출처). 재개·대조(reconcile)는 이 이름으로 찾는다.
// 네이버 이름 한도 30자(invariants.NAVER_NAME_MAX, 빌더가 강제). proposalId는 cuid 25자.
// - 캠페인 mq-{proposalId} = 28자
// - 광고그룹 {proposalId}-g{n} = 28자(n ≤ MAX_GROUPS 5). mq- 접두어를 붙이면 31자 → 실운영 400/3711(광고그룹 이름 길이, 2026-11-12).
//   부모 캠페인 아래에서만 찾으므로(reconcile.findAdgroups) 접두어 없이도 이 제안의 그룹으로 식별된다.

export const campaignName = (proposalId: string) => `mq-${proposalId}`;
export const adgroupName = (proposalId: string, n: number) => `${proposalId}-g${n}`;
