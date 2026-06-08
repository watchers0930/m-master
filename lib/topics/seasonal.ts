// lib/topics/seasonal.ts — 월별 시즌 키워드 (범용 마케팅 + 유저 키워드 조합)

const SEASONAL_KEYWORDS: Record<number, string[]> = {
  1: ['신년 트렌드', '연초 전략', '새해 계획', '1분기 준비'],
  2: ['봄 시즌 준비', '신학기 마케팅', '설 연휴 전략'],
  3: ['봄 시즌', '봄맞이', '신규 고객 유치', '봄 트렌드'],
  4: ['상반기 마케팅', '봄 성수기', '신규 캠페인'],
  5: ['가정의달 마케팅', '5월 시즌', '고객 감사 이벤트'],
  6: ['상반기 결산', '하반기 전략', '여름 시즌 준비'],
  7: ['하반기 전략', '여름 시즌', '휴가철 마케팅'],
  8: ['가을 시즌 준비', '하반기 성과 점검', '추석 마케팅'],
  9: ['가을 시즌', '추석 시즌', '4분기 전략'],
  10: ['가을 성수기', '연말 준비', '블랙프라이데이 준비'],
  11: ['연말 마케팅', '연말 결산', '올해의 트렌드'],
  12: ['연말 정리', '신년 전략 수립', '연말 이벤트', '크리스마스 시즌'],
};

export function getSeasonalKeywords(month: number, userKeywords?: string[]): string[] {
  if (month < 1 || month > 12) return [];
  const generic = SEASONAL_KEYWORDS[month] ?? [];
  if (!userKeywords?.length) return generic;
  // 유저 키워드(최대 3개) × 시즌 조합
  const combos: string[] = [];
  for (const season of generic.slice(0, 3)) {
    for (const kw of userKeywords.slice(0, 3)) {
      combos.push(`${season} ${kw}`);
    }
  }
  return combos;
}
