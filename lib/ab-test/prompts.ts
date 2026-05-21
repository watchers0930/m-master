// lib/ab-test/prompts.ts — A/B 변형 시드 프롬프트
// plan.md §7.1: 변형 A·B에 명확히 다른 톤·구성 가이드를 추가하여 같은 토픽이라도
// 톤·구성이 다른 두 콘텐츠를 생성하기 위한 system prompt 추가지시문.

export type AbVariantKey = 'a' | 'b';

export interface VariantSeed {
  /** UI/로깅용 라벨 */
  label: string;
  /** system prompt에 append되는 변형 지시문 */
  directive: string;
}

/**
 * 변형 A: 정보·분석 톤 / 단락 중심 구성 / 데이터·근거 강조
 * 변형 B: 스토리·체험 톤 / 리스트·헤딩 빈번 / 사례·후기 강조
 */
export const VARIANT_SEEDS: Record<AbVariantKey, VariantSeed> = {
  a: {
    label: '정보·분석형',
    directive: [
      '## A/B 변형 지시 — 정보·분석 톤',
      '- 톤: 객관적·분석적, 데이터·법령·수치를 핵심으로 제시',
      '- 구성: 단락(문단) 중심으로 서술, 불필요한 리스트 분할 자제',
      '- 강조: 통계·법조항·기관 출처를 본문에 명시 인용',
      '- H2 5~7개 구조 유지, 각 H2 본문은 200자 이상 단락 중심',
      '- 도입부는 사실 진술/현황 요약으로 시작',
    ].join('\n'),
  },
  b: {
    label: '스토리·체험형',
    directive: [
      '## A/B 변형 지시 — 스토리·체험 톤',
      '- 톤: 공감·체험적, 실제 사례·고객 후기·일화 중심으로 전개',
      '- 구성: 리스트·헤딩 빈번 사용 (bullet, H3 적극 활용)',
      '- 강조: 구체적 인물·상황·감정 묘사, 절차는 단계별 체크리스트',
      '- H2 5~7개 구조 유지, 각 H2에 사례·후기 1건 이상 포함',
      '- 도입부는 구체적 상황 묘사 또는 질문형으로 시작',
    ].join('\n'),
  },
};

export function getVariantSeed(key: AbVariantKey): VariantSeed {
  return VARIANT_SEEDS[key];
}
