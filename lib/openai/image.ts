// lib/openai/image.ts — OpenAI 이미지 생성 (서버 전용)
import OpenAI from 'openai';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 환경변수 미설정');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

const IMAGE_COST_KRW = 100;

export function calcImageKrw(): number {
  return IMAGE_COST_KRW;
}

export interface ImageGenResult {
  url: string;
  revised_prompt: string;
}

function getImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || 'dall-e-3';
}

function isGptImageModel(model: string): boolean {
  return model.startsWith('gpt-image');
}

export async function generateThumbnail(
  topic: string,
  stylePrompt?: string,
): Promise<ImageGenResult> {
  const client = getClient();
  const model = getImageModel();
  const useGptImage = isGptImageModel(model);

  const prompt = [
    `VESTRA(AI 부동산 권리분석·시세분석 서비스) 마케팅 블로그 썸네일. 주제: "${topic}".`,
    stylePrompt ??
      '클린 미니멀, 진청 계열 색상, AI·부동산 전문성 강조, 텍스트 오버레이를 위한 여백 확보, 한국 부동산 스타일',
    '텍스트·글자 없음. 고해상도 상업용 이미지.',
  ].join(' ');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model,
    prompt,
    n: 1,
    size: useGptImage ? '1536x1024' : '1792x1024',
    quality: useGptImage ? 'medium' : 'standard',
    response_format: 'url',
  };

  const res = await client.images.generate(params);
  const image = res.data?.[0];
  if (!image?.url) throw new Error(`${model} 이미지 URL 반환 없음`);

  return {
    url: image.url,
    revised_prompt: image.revised_prompt ?? prompt,
  };
}
