// lib/topics/candidates.ts — 룰 기반 토픽 후보 생성기 (15~20개)
// 근거: VESTRA 핵심 서비스 — 권리분석, 시세분석, 시세전망, 전세보증보험, 동네정보
// 자의 작성 금지 — 코어 키워드는 VESTRA 서비스 도메인에서만

import { getSeasonalKeywords } from './seasonal';

export type CandidateSignal = 'season' | 'core' | 'ga4_popular' | 'gap';

export interface Candidate {
  topic: string; // 80자 이내
  signal: CandidateSignal;
  weight: number; // 1~10
}

// ----------------------------------------------------------------
// 코어 키워드 사전 (VESTRA 서비스 근거)
// ----------------------------------------------------------------

// 권리분석 — 부동산 안전 거래 핵심
const RIGHTS_CORE = [
  '아파트 권리분석',
  '등기부등본 보는 법',
  '근저당 확인 방법',
  '전세사기 예방 체크리스트',
  '가압류·가처분 확인',
  '소유권 이전 절차',
  '부동산 매매 계약 전 확인사항',
];

// 시세·전망 — 부동산 투자·매매 의사결정
const MARKET_CORE = [
  '아파트 실거래가 조회',
  '전세 시세 확인 방법',
  '부동산 시세 전망',
  '재건축 투자 분석',
  '신축 vs 구축 비교',
  '학군별 아파트 시세',
  '역세권 시세 프리미엄',
];

// 전세·임대 — 세입자 보호
const LEASE_CORE = [
  '전세보증보험 가입 방법',
  '전세 계약 갱신 절차',
  '임대차 3법 핵심 정리',
  '역전세 대비 방법',
  '보증금 반환 소송 절차',
];

// GA4 path → 토픽 매핑 사전 (VESTRA 핵심 페이지 한정)
const PATH_TO_TOPIC: { match: RegExp; topic: string }[] = [
  { match: /^\/rights/, topic: '부동산 권리분석 AI로 5분 만에 끝내기' },
  { match: /^\/price-map/, topic: '우리 동네 아파트 실거래가 한눈에 보기' },
  { match: /^\/prediction/, topic: '아파트 시세 전망 AI 분석 결과' },
  { match: /^\/jeonse/, topic: '전세 안전 체크리스트 AI 진단' },
  { match: /^\/insurance/, topic: '전세보증보험 가입 조건과 절차' },
  { match: /^\/neighborhood/, topic: '동네정보 비교 분석으로 최적 입지 찾기' },
  { match: /^\/tax/, topic: '부동산 세금 계산 한눈에 정리' },
  { match: /^\/expert/, topic: '전문가 상담 연결로 안전한 거래' },
];

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
    // 부분 일치 70%+ — 짧은 쪽이 긴 쪽에 substring으로 포함 + 길이비 0.7+
    const [shorter, longer] = pn.length <= c.length ? [pn, c] : [c, pn];
    if (shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.7) {
      return true;
    }
  }
  return false;
}

function pathToTopic(path: string): string | null {
  for (const { match, topic } of PATH_TO_TOPIC) {
    if (match.test(path)) return topic;
  }
  return null;
}

// ----------------------------------------------------------------
// buildCandidates — 후보 15~20개 생성
// ----------------------------------------------------------------

export interface BuildCandidatesInput {
  monthYmd: string; // YYYY-MM-01
  publishedTopics: string[];
  ga4PopularPaths?: { path: string; sessions: number }[];
}

export function buildCandidates(input: BuildCandidatesInput): Candidate[] {
  const month = parseInt(input.monthYmd.slice(5, 7), 10);
  const seasonals = getSeasonalKeywords(month);
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

  // 1) 시즌 × 코어 조합 (가중치 10)
  for (const season of seasonals) {
    push(`${season} 시 ${RIGHTS_CORE[0]} 핵심 정리`, 'season', 10);
    push(`${season} ${LEASE_CORE[0]} 꼭 확인하세요`, 'season', 9);
    push(`${season} ${MARKET_CORE[2]} 분석`, 'season', 9);
    if (candidates.length >= 8) break;
  }

  // 2) GA4 인기 path → 토픽 매핑 (가중치 9)
  const ga4 = (input.ga4PopularPaths ?? []).slice(0, 10);
  for (const { path, sessions } of ga4) {
    const topic = pathToTopic(path);
    if (!topic) continue;
    const weight = sessions >= 100 ? 9 : 8;
    push(topic, 'ga4_popular', weight);
  }

  // 3) 코어 단독 키워드 (가중치 7)
  for (const core of [...RIGHTS_CORE.slice(0, 5), ...MARKET_CORE.slice(0, 4), ...LEASE_CORE.slice(0, 3)]) {
    push(`2026년 ${core} 완벽 가이드`, 'core', 7);
    if (candidates.length >= 18) break;
  }

  // 4) gap (발행 부족 영역) — 세금·전문가연결 등은 발행이 적은 편이라 보강
  const gapTopics = [
    '부동산 세금 종류와 계산 방법 총정리',
    '전세사기 유형별 예방법과 대처 방안',
    '초보 매수자가 놓치기 쉬운 등기부등본 체크포인트',
  ];
  for (const g of gapTopics) {
    push(g, 'gap', 6);
    if (candidates.length >= 20) break;
  }

  return candidates.slice(0, 20);
}
