// lib/api/content.ts — 콘텐츠 API 래퍼
import type {
  ContentListResponse,
  ApiResponse,
} from '@/types/api';
import type { Content } from '@/types/db';

const BASE = '/api/content';

export async function listContents(params?: {
  status?: string;
  channel?: string;
  page?: number;
  per_page?: number;
}): Promise<ApiResponse<ContentListResponse>> {
  const qs = new URLSearchParams();
  if (params?.status)   qs.set('status',   params.status);
  if (params?.channel)  qs.set('channel',  params.channel);
  if (params?.page)     qs.set('page',     String(params.page));
  if (params?.per_page) qs.set('per_page', String(params.per_page));
  const res = await fetch(`/api/content?${qs}`);
  return res.json();
}

export async function getContent(id: string): Promise<ApiResponse<Content>> {
  const res = await fetch(`${BASE}/${id}`);
  return res.json();
}

// 토픽 기반 키워드 자동 생성
export async function generateKeywords(topic: string): Promise<ApiResponse<string[]>> {
  await new Promise((r) => setTimeout(r, 600));

  const domainMap: [RegExp, string[]][] = [
    [/매매|소유권|이전/, ['소유권이전등기', '부동산매매', '취득세', '등기비용', '잔금']],
    [/법인|설립|회사/, ['법인설립등기', '법인설립비용', '상업등기', '자본금', '정관']],
    [/근저당|담보|저당/, ['근저당설정등기', '담보대출', '채권최고액', '저당권', '금융기관']],
    [/상속|증여|유산/, ['상속등기', '증여등기', '상속세', '취득세면제', '법정상속']],
    [/전세|임대|보증/, ['전세권설정등기', '임차권등기', '보증금반환', '전세사기예방', '확정일자']],
    [/건물|빌딩|상가/, ['건물등기', '집합건물', '상가분양', '건축물대장', '구분소유권']],
    [/토지|대지|임야/, ['토지등기', '지목변경', '농지취득', '토지거래허가', '공시지가']],
  ];

  const keywords = new Set<string>();

  topic.split(/[\s,·]+/).filter(w => w.length >= 2).forEach(w => keywords.add(w));

  for (const [pattern, related] of domainMap) {
    if (pattern.test(topic)) {
      related.forEach(k => keywords.add(k));
      break;
    }
  }

  ['부동산', 'AI권리분석', '시세분석', '부동산안전', 'VESTRA'].forEach(k => keywords.add(k));

  return { data: Array.from(keywords).slice(0, 12), error: null };
}
