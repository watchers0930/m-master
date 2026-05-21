// lib/openai/image.ts — DALL-E 3 썸네일 생성 (서버 전용)
import OpenAI from 'openai';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 환경변수 미설정');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

const IMAGE_COST_KRW = 100; // DALL-E 3 standard 기준 ~100원

export function calcImageKrw(): number {
  return IMAGE_COST_KRW;
}

export interface ImageGenResult {
  url: string;
  revised_prompt: string;
}

export async function generateThumbnail(
  topic: string,
  stylePrompt?: string,
): Promise<ImageGenResult> {
  const client = getClient();

  const prompt = [
    `VESTRA(AI 부동산 권리분석·시세분석 서비스) 마케팅 블로그 썸네일. 주제: "${topic}".`,
    stylePrompt ??
      '클린 미니멀, 진청 계열 색상, AI·부동산 전문성 강조, 텍스트 오버레이를 위한 여백 확보, 한국 부동산 스타일',
    '텍스트·글자 없음. 고해상도 상업용 이미지.',
  ].join(' ');

  const res = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1792x1024',
    quality: 'standard',
    response_format: 'url',
  });

  const image = res.data?.[0];
  if (!image?.url) throw new Error('DALL-E 3 이미지 URL 반환 없음');

  return {
    url: image.url,
    revised_prompt: image.revised_prompt ?? prompt,
  };
}
