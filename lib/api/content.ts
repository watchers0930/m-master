// lib/api/content.ts — 콘텐츠 생성/관리 API 래퍼 (mock 포함)
// BE API 완성 후 mock → 실제 fetch로 교체
import type {
  ContentGenerateRequest,
  ContentGenerateResponse,
  ContentListResponse,
  ApiResponse,
} from '@/types/api';
import type { Content } from '@/types/db';

const BASE = '/api/content';

// ── Mock 데이터 ───────────────────────────────────────────────────

const MOCK_CONTENTS: Content[] = [
  {
    id: 'c1',
    owner_id: 'owner',
    channel: 'blog',
    topic: '부동산 등기 절차 완벽 가이드',
    tone: '전문적',
    keywords: ['등기', '부동산', '절차'],
    text_body: '부동산 등기는 법적 효력을 갖는 중요한 절차입니다...',
    image_url: null,
    body_image_urls: [],
    scores: { seo: 82, readability: 78, brand: 90, legal: 95, avg: 86 },
    cost_krw: 420,
    status: 'published',
    created_at: '2026-05-01T09:00:00Z',
    updated_at: '2026-05-01T09:30:00Z',
  },
  {
    id: 'c2',
    owner_id: 'owner',
    channel: 'blog',
    topic: '법인 설립 등기 비용 안내',
    tone: '친근한',
    keywords: ['법인', '설립', '비용'],
    text_body: '법인을 설립할 때 등기비용은 자본금에 따라 달라집니다...',
    image_url: null,
    body_image_urls: [],
    scores: { seo: 75, readability: 80, brand: 85, legal: 92, avg: 83 },
    cost_krw: 420,
    status: 'scheduled',
    created_at: '2026-05-03T10:00:00Z',
    updated_at: '2026-05-03T10:15:00Z',
  },
  {
    id: 'c3',
    owner_id: 'owner',
    channel: 'blog',
    topic: '근저당 설정 등기 알아보기',
    tone: '정보제공',
    keywords: ['근저당', '설정', '담보'],
    text_body: '근저당권은 채권의 최고액을 미리 정하는 방식의 담보물권입니다...',
    image_url: null,
    body_image_urls: [],
    scores: null,
    cost_krw: 420,
    status: 'draft',
    created_at: '2026-05-05T14:00:00Z',
    updated_at: '2026-05-05T14:00:00Z',
  },
];

// ── API 함수 ──────────────────────────────────────────────────────

export async function generateContent(
  req: ContentGenerateRequest
): Promise<ApiResponse<ContentGenerateResponse>> {
  const res = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await res.json();
  if (!res.ok) return { data: null, error: data.error };
  return { data: data.data, error: null };
}

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

export async function deleteContent(id: string): Promise<ApiResponse<null>> {
  // TODO: BE 연동
  void id;
  return { data: null, error: null };
}

export async function publishBlog(contentId: string): Promise<ApiResponse<{ html: string; filename: string; download_url: string }>> {
  // TODO: BE 연동
  await new Promise((r) => setTimeout(r, 500));
  const content = MOCK_CONTENTS.find((c) => c.id === contentId);
  const slug = (content?.topic ?? 'content').replace(/\s+/g, '-').toLowerCase();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `blog_${date}_${slug}.html`;

  return {
    data: {
      html: `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${content?.topic ?? ''}</title></head><body>${content?.text_body ?? ''}</body></html>`,
      filename,
      download_url: `/api/publish/blog/${contentId}`,
    },
    error: null,
  };
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
