// lib/external/molit.ts — 국토교통부 실거래가 경량 클라이언트 (서버 전용)
// VESTRA lib/molit-api.ts에서 핵심 로직만 추출 (매매·전세 조회)

// ─── 법정동 코드 매핑 (주요 지역) ───
const LAWD_CODE_MAP: Record<string, string> = {
  // 서울
  "강남구": "11680", "서초구": "11650", "송파구": "11710", "강동구": "11740",
  "마포구": "11440", "용산구": "11170", "성동구": "11200", "광진구": "11215",
  "동작구": "11590", "영등포구": "11560", "양천구": "11470", "강서구": "11500",
  "구로구": "11530", "금천구": "11545", "관악구": "11620", "노원구": "11350",
  "도봉구": "11320", "강북구": "11305", "성북구": "11290", "중랑구": "11260",
  "동대문구": "11230", "종로구": "11110", "은평구": "11380", "서대문구": "11410",
  "중구": "11140",
  // 경기
  "수원시": "41117", "수원": "41117", "성남시": "41135", "분당": "41135",
  "고양시": "41285", "일산": "41285", "용인시": "41463",
  "화성시": "41597", "파주시": "41480", "김포시": "41570", "하남시": "41450",
  "광명시": "41210", "남양주시": "41360", "부천시": "41190",
  // 부산
  "해운대구": "26350", "부산진구": "26230", "동래구": "26260",
  "수영구": "26500", "연제구": "26470", "사하구": "26380",
  // 대구
  "수성구": "27260", "달서구": "27290",
  // 인천
  "연수구": "28185", "남동구": "28200", "부평구": "28237",
  // 광역시 약식
  "부산": "26350", "대구": "27260", "인천": "28260",
  "광주": "29200", "대전": "30200", "울산": "31140",
  "세종": "36110", "세종시": "36110",
  // 제주
  "제주시": "50110", "서귀포시": "50130", "제주": "50110",
};

// 부동산 관련 키워드 (토픽에서 감지)
const REAL_ESTATE_KEYWORDS = [
  '부동산', '아파트', '전세', '월세', '매매', '분양', '재건축', '재개발',
  '시세', '집값', '주택', '오피스텔', '빌라', '상가', '토지', '임대',
  '전월세', '실거래', '청약', '대출', '주담대', '갭투자', '역전세',
  '등기', '권리분석', '계약', '중개', '공인중개사',
];

/** 토픽이 부동산 관련인지 판단 */
export function isRealEstateTopic(topic: string): boolean {
  return REAL_ESTATE_KEYWORDS.some((kw) => topic.includes(kw));
}

/** 토픽/키워드에서 법정동 코드 추출 */
export function extractLawdCode(text: string): string | null {
  const normalized = text
    .replace(/특별자치시|특별자치도|특별시|광역시/g, '')
    .replace(/\s+/g, '');

  const entries = Object.entries(LAWD_CODE_MAP)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, code] of entries) {
    if (normalized.includes(key)) return code;
  }
  return null;
}

/** XML 태그 값 추출 */
function extractXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>\\s*([^<]*)\\s*</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractVal(xml: string, eng: string, kor: string): string {
  return extractXmlValue(xml, eng) || extractXmlValue(xml, kor);
}

/** MOLIT API fetch (8초 타임아웃) */
async function molitFetch(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { Accept: 'application/xml', 'User-Agent': 'M-Master/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface SimpleTrade {
  amount: number;    // 만원 단위
  aptName: string;
  area: number;      // ㎡
  dong: string;
  dealYear: number;
  dealMonth: number;
}

/** 매매 XML 파싱 */
function parseTrades(xml: string): SimpleTrade[] {
  const items: SimpleTrade[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const amountRaw = extractVal(item, 'dealAmount', '거래금액').replace(/,/g, '');
    const amount = parseInt(amountRaw, 10);
    if (isNaN(amount) || amount <= 0) continue;

    items.push({
      amount,
      aptName: extractVal(item, 'aptNm', '아파트') || extractVal(item, 'aptNm', '단지명'),
      area: parseFloat(extractVal(item, 'excluUseAr', '전용면적')) || 0,
      dong: extractVal(item, 'umdNm', '법정동'),
      dealYear: parseInt(extractVal(item, 'dealYear', '년'), 10) || 0,
      dealMonth: parseInt(extractVal(item, 'dealMonth', '월'), 10) || 0,
    });
  }
  return items;
}

/** 전세 XML 파싱 */
function parseRents(xml: string): { deposit: number; dong: string; aptName: string }[] {
  const items: { deposit: number; dong: string; aptName: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const depositRaw = extractVal(item, 'deposit', '보증금액').replace(/,/g, '').trim();
    const deposit = parseInt(depositRaw, 10);
    if (isNaN(deposit) || deposit <= 0) continue;

    const monthlyRent = parseInt(
      extractVal(item, 'monthlyRent', '월세금액').replace(/,/g, '').trim() || '0',
      10,
    );
    // 전세만 (월세=0)
    if (monthlyRent > 0) continue;

    items.push({
      deposit,
      dong: extractVal(item, 'umdNm', '법정동'),
      aptName: extractVal(item, 'aptNm', '아파트') || extractVal(item, 'aptNm', '단지명'),
    });
  }
  return items;
}

// 인메모리 캐시 (3분 TTL)
const cache = new Map<string, { data: string; expires: number }>();
const CACHE_TTL = 3 * 60 * 1000;

/**
 * 토픽에서 지역을 추출하여 최근 3개월 실거래 시세 요약 반환
 * @returns 포맷된 시세 문자열 (해당 없으면 빈 문자열)
 */
export async function fetchRecentPriceSummary(topic: string, keywords: string[] = []): Promise<string> {
  // 부동산 토픽이 아니면 스킵
  if (!isRealEstateTopic(topic)) return '';

  const serviceKey = process.env.MOLIT_API_KEY;
  if (!serviceKey) {
    console.warn('[molit] MOLIT_API_KEY 미설정');
    return '';
  }

  // 토픽+키워드에서 지역 코드 추출
  const combined = [topic, ...keywords].join(' ');
  const lawdCode = extractLawdCode(combined);
  if (!lawdCode) return '';

  // 캐시 확인
  const cacheKey = `molit:${lawdCode}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const now = new Date();
    const months = 3;

    // 최근 3개월 매매 + 전세 병렬 조회
    const dealYmds = Array.from({ length: months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const tradeUrl = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
    const rentUrl = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

    const fetchTasks = dealYmds.flatMap((ymd) => [
      molitFetch(`${tradeUrl}?${new URLSearchParams({ serviceKey, LAWD_CD: lawdCode, DEAL_YMD: ymd, pageNo: '1', numOfRows: '500' })}`),
      molitFetch(`${rentUrl}?${new URLSearchParams({ serviceKey, LAWD_CD: lawdCode, DEAL_YMD: ymd, pageNo: '1', numOfRows: '500' })}`),
    ]);

    const results = await Promise.all(fetchTasks);

    // 매매 (짝수 인덱스) / 전세 (홀수 인덱스) 분리
    const allTrades: SimpleTrade[] = [];
    const allRents: { deposit: number; dong: string; aptName: string }[] = [];

    results.forEach((xml, i) => {
      if (!xml) return;
      if (i % 2 === 0) allTrades.push(...parseTrades(xml));
      else allRents.push(...parseRents(xml));
    });

    if (allTrades.length === 0 && allRents.length === 0) return '';

    // 요약 포맷
    const lines: string[] = [];
    const latestMonth = dealYmds[0];
    const year = latestMonth.slice(0, 4);
    const month = parseInt(latestMonth.slice(4), 10);

    if (allTrades.length > 0) {
      const prices = allTrades.map((t) => t.amount);
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      const min = Math.min(...prices);
      const max = Math.max(...prices);

      lines.push(`- 아파트 평균 매매가: ${formatPrice(avg)} (최저 ${formatPrice(min)} ~ 최고 ${formatPrice(max)})`);
      lines.push(`- 최근 3개월 매매 거래량: ${allTrades.length}건`);
    }

    if (allRents.length > 0) {
      const deposits = allRents.map((r) => r.deposit);
      const avg = Math.round(deposits.reduce((a, b) => a + b, 0) / deposits.length);
      lines.push(`- 평균 전세 보증금: ${formatPrice(avg)}`);
      lines.push(`- 최근 3개월 전세 거래량: ${allRents.length}건`);
    }

    // 전세가율
    if (allTrades.length > 0 && allRents.length > 0) {
      const avgTrade = allTrades.reduce((a, b) => a + b.amount, 0) / allTrades.length;
      const avgRent = allRents.reduce((a, b) => a + b.deposit, 0) / allRents.length;
      const ratio = Math.round((avgRent / avgTrade) * 1000) / 10;
      lines.push(`- 전세가율: ${ratio}%`);
    }

    const result = `[실거래 시세 — 국토교통부 ${year}년 ${month}월 기준]\n${lines.join('\n')}`;

    // 캐시 저장
    cache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL });

    return result;
  } catch (err) {
    console.warn('[molit] 시세 조회 실패:', err);
    return '';
  }
}

/** 만원 단위 → 억원/만원 표시 */
function formatPrice(manwon: number): string {
  if (manwon >= 10000) {
    const eok = Math.floor(manwon / 10000);
    const remainder = manwon % 10000;
    return remainder > 0 ? `${eok}억 ${remainder.toLocaleString()}만원` : `${eok}억원`;
  }
  return `${manwon.toLocaleString()}만원`;
}
