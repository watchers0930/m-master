// app/api/debug/image-check/route.ts — 이미지 서비스 진단 (운영에서 삭제 예정)
import { NextResponse } from 'next/server';

export async function GET() {
  const results: Record<string, unknown> = {};

  // 1) Unsplash 테스트
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  results.unsplash_key_set = !!unsplashKey;
  results.unsplash_key_type = typeof unsplashKey;
  results.unsplash_key_len = unsplashKey?.length ?? 0;
  if (unsplashKey) {
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=apartment&per_page=1&orientation=landscape&content_filter=high`,
        { headers: { Authorization: `Client-ID ${unsplashKey}`, 'Accept-Version': 'v1' } },
      );
      const body = await res.text();
      results.unsplash_status = res.status;
      results.unsplash_ratelimit = res.headers.get('x-ratelimit-remaining');
      if (res.ok) {
        const json = JSON.parse(body);
        results.unsplash_results = json.results?.length ?? 0;
        results.unsplash_first_url = json.results?.[0]?.urls?.regular?.substring(0, 80) ?? null;
      } else {
        results.unsplash_error = body.substring(0, 200);
      }
    } catch (err) {
      results.unsplash_error = err instanceof Error ? err.message : String(err);
    }
  }

  // CREDENTIAL_ENCRYPTION_SECRET 체크 (다른 키 참고용)
  results.credential_key_set = !!process.env.CREDENTIAL_ENCRYPTION_SECRET;

  // 2) OpenAI API 키 확인 (이미지 생성은 비용 발생하므로 키 유효성만 확인)
  const openaiKey = process.env.OPENAI_API_KEY;
  results.openai_key_set = !!openaiKey;
  results.openai_image_model = process.env.OPENAI_IMAGE_MODEL ?? 'not_set';
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openaiKey}` },
      });
      results.openai_status = res.status;
      if (res.ok) {
        const json = await res.json() as { data?: { id: string }[] };
        const hasDalle = json.data?.some((m: { id: string }) => m.id.includes('dall-e'));
        results.openai_has_dalle = hasDalle;
      } else {
        const body = await res.text();
        results.openai_error = body.substring(0, 200);
      }
    } catch (err) {
      results.openai_error = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json(results);
}
