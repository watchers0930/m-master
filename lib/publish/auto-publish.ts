import { deriveCafeContent } from './derive';
export interface AutoPublishEvent {
  type: 'auto_publish'; channel?: 'instagram' | 'facebook' | 'naver_cafe';
  status: 'converting' | 'publishing' | 'success' | 'failed' | 'completed'; url?: string; error?: string;
}
/** Compatibility adapter: automatically converted text is saved for human review only. */
export async function autoPublishToSocial(params: {
  blogContentId: string; ownerId: string; blogText: string; topic: string; keywords?: string[];
  imageUrl: string | null; bodyImageUrls: string[]; blogScores: Record<string, number> | null;
  onProgress: (event: AutoPublishEvent) => void;
}) {
  const derived = await deriveCafeContent(params.ownerId, params.blogContentId);
  // 자격증명 키 오류는 조용히 넘기지 않는다: 카페 변환 실패를 사유 코드로 알린 뒤 completed로 마무리
  if (derived.status === 'skipped' && derived.reason === 'credential_storage_error') {
    params.onProgress({ type: 'auto_publish', channel: 'naver_cafe', status: 'failed', error: 'credential_storage_error' });
  }
  params.onProgress({ type: 'auto_publish', status: 'completed' });
}
