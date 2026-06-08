// lib/topics/candidates.ts — 룰 기반 토픽 후보 생성기 (15~20개)
// businessContext로 유저 업종/키워드 기반 동적 후보 생성

import { getSeasonalKeywords } from './seasonal';

export type CandidateSignal = 'season' | 'core' | 'ga4_popular' | 'gap';

export interface Candidate {
  topic: string; // 80자 이내
  signal: CandidateSignal;
  weight: number; // 1~10
}

export interface BusinessContext {
  industry?: string;
  coreKeywords?: string[];
  services?: string[];
  companyName?: string;
}

// 업종별 기본 키워드 (유저가 core_keywords 미입력 시 폴백)
const INDUSTRY_DEFAULTS: Record<string, string[]> = {
  '부동산': ['아파트 매매', '전세 계약', '부동산 투자', '시세 분석', '권리분석'],
  '건설/시공': ['아파트 시공', '리모델링', '인테리어', '건축 설계', '시공 사례'],
  'IT/소프트웨어': ['SaaS 도입', '클라우드 전환', '보안 솔루션', 'AI 활용', '업무 자동화'],
  '교육': ['온라인 교육', '학습 콘텐츠', '교육 트렌드', '자격증 취득', '커리큘럼 설계'],
  '의료/건강': ['건강 관리', '의료 서비스', '건강 검진', '예방 의학', '웰니스 트렌드'],
  '뷰티/패션': ['뷰티 트렌드', '스킨케어', '패션 스타일링', '시즌 컬렉션', '브랜드 스토리'],
  'F&B': ['맛집 트렌드', '메뉴 개발', '식재료 관리', '외식 마케팅', '배달 전략'],
  '금융/보험': ['재테크 전략', '보험 상품', '투자 분석', '자산 관리', '금융 트렌드'],
  '제조업': ['생산 효율화', '품질 관리', '스마트팩토리', '공급망 관리', '제조 트렌드'],
};

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

function truncate80(text: string): string {
  return text.length > 80 ? text.slice(0, 80) : text;
}

function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

function isDuplicate(candidate: string, published: string[]): boolean {
  const c = normalizeForMatch(candidate);
  if (!c) return true;
  for (const p of published) {
    const pn = normalizeForMatch(p);
    if (!pn) continue;
    if (pn === c) return true;
    const [shorter, longer] = pn.length <= c.length ? [pn, c] : [c, pn];
    if (shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.7) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------
// buildCandidates — 후보 15~20개 생성
// ----------------------------------------------------------------

export interface BuildCandidatesInput {
  monthYmd: string; // YYYY-MM-01
  publishedTopics: string[];
  ga4PopularPaths?: { path: string; sessions: number }[];
  businessContext?: BusinessContext;
}

export function buildCandidates(input: BuildCandidatesInput): Candidate[] {
  const month = parseInt(input.monthYmd.slice(5, 7), 10);
  const biz = input.businessContext ?? {};
  const coreKeywords = biz.coreKeywords?.length
    ? biz.coreKeywords
    : INDUSTRY_DEFAULTS[biz.industry ?? ''] ?? ['마케팅 전략', '고객 유치', '브랜드 성장', '콘텐츠 마케팅', '온라인 홍보'];
  const services = biz.services ?? [];
  const seasonals = getSeasonalKeywords(month, coreKeywords);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const push = (topic: string, signal: CandidateSignal, weight: number) => {
    const t = truncate80(topic.trim());
    if (!t) return;
    const key = normalizeForMatch(t);
    if (seen.has(key)) return;
    if (isDuplicate(t, input.publishedTopics)) return;
    seen.add(key);
    candidates.push({ topic: t, signal, weight });
  };

  // 1) 시즌 × 유저 키워드 조합 (가중치 10)
  for (const season of seasonals) {
    push(season, 'season', 10 - (candidates.length % 2));
    if (candidates.length >= 9) break;
  }

  // 2) GA4 인기 페이지 기반 (가중치 9)
  const ga4 = (input.ga4PopularPaths ?? []).slice(0, 10);
  for (const { path, sessions } of ga4) {
    // path에서 토픽 추출 (슬래시 제거, 하이픈→공백)
    const slug = path.replace(/^\//, '').replace(/\/$/, '').replace(/-/g, ' ');
    if (!slug || slug === '') continue;
    const topic = `${slug} 완벽 가이드`;
    const weight = sessions >= 100 ? 9 : 8;
    push(topic, 'ga4_popular', weight);
  }

  // 3) 서비스 키워드 (가중치 8)
  for (const svc of services.slice(0, 5)) {
    push(`${svc} 가이드 — 꼭 알아야 할 핵심 포인트`, 'core', 8);
    if (candidates.length >= 14) break;
  }

  // 4) 코어 키워드 단독 (가중치 7)
  const year = new Date().getFullYear();
  for (const kw of coreKeywords) {
    push(`${year}년 ${kw} 완벽 가이드`, 'core', 7);
    if (candidates.length >= 18) break;
  }

  // 5) 업종 기본 키워드 갭 보충 (가중치 6)
  const industryDefaults = INDUSTRY_DEFAULTS[biz.industry ?? ''] ?? [];
  for (const kw of industryDefaults) {
    push(`${kw} 트렌드와 핵심 전략 총정리`, 'gap', 6);
    if (candidates.length >= 20) break;
  }

  return candidates.slice(0, 20);
}
