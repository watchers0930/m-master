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
  await deriveCafeContent(params.ownerId, params.blogContentId);
  params.onProgress({ type: 'auto_publish', status: 'completed' });
}
