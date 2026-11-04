// hooks/usePublishContent.ts
// 상세 패널의 발행·변환·A/B 시작 핸들러 (기존 ContentDetailPanel 에서 이전, 설계 §6).
// 발행 가능 여부는 서버(isPublishable)가 최종 판정 — 409 사유를 안내하고 상세를 재조회한다.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createAbTest } from '@/lib/api/ab-test';
import type { AbTestMeasureDays } from '@/types/db';
import { publishContent, convertContent, ContentApiError } from '@/lib/api/content';
import type { ConvertChannel, PublishChannel } from '@/types/content-review';
import { contentKeys, refreshContent } from './useContentDetail';

const CHANNEL_LABEL: Record<PublishChannel, string> = {
  naver_cafe: '네이버 카페', instagram: '인스타그램', facebook: '페이스북',
};

/** 발행 API 실패 코드 → 안내 (설계 §4.4) */
const PUBLISH_ERROR_TEXT: Record<string, string> = {
  not_approved: '승인되지 않은 콘텐츠입니다. 먼저 승인해 주세요.',
  rejected: '반려된 콘텐츠는 발행할 수 없습니다.',
  already_published: '이미 발행된 콘텐츠입니다.',
  publish_in_progress: '이미 발행이 진행 중입니다.',
  channel_error: '채널 연동 오류로 발행하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

function errText(err: unknown, fallback: string): string {
  if (err instanceof ContentApiError) return PUBLISH_ERROR_TEXT[err.code] ?? err.message;
  return err instanceof Error ? err.message : fallback;
}

export function usePublishContent(contentId: string | null) {
  const router = useRouter();
  const qc = useQueryClient();
  const [publishing, setPublishing] = useState<PublishChannel | undefined>(undefined);
  const [converting, setConverting] = useState<ConvertChannel | undefined>(undefined);
  const [abStarting, setAbStarting] = useState(false);
  const [abError, setAbError] = useState<string | null>(null);

  const publish = async (channel: PublishChannel) => {
    if (!contentId || publishing) return;
    const label = CHANNEL_LABEL[channel];
    setPublishing(channel);
    try {
      const r = await publishContent(channel, contentId);
      if (r.results) {
        const ok = r.results.filter((x) => !x.error).length;
        const failed = r.results.filter((x) => x.error).map((x) => x.name).join(', ');
        alert(r.partial ? `${label} 일부 발행 실패 (성공 ${ok}/${r.results.length})\n실패: ${failed}` : `${label} ${ok}곳 발행 완료`);
        return;
      }
      const url = r?.url ?? r?.download_url;
      if (url && window.confirm(`${label} 발행 완료!\n${url}\n\n게시물을 열어볼까요?`)) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert(`${label} 발행 완료`);
      }
    } catch (err) {
      alert(`${label} 발행 실패: ${errText(err, '발행 오류')}`);
    } finally {
      setPublishing(undefined);
      await refreshContent(qc, contentId); // 성공·차단 모두 서버 발행 상태로 갱신
    }
  };

  const convert = async (channel: ConvertChannel, id: string) => {
    if (converting) return;
    setConverting(channel);
    try {
      const r = await convertContent(id, channel);
      // 새 콘텐츠가 목록에 바로 보이도록 목록 캐시를 무효화한다(신선한 캐시에 가려지지 않게)
      await qc.invalidateQueries({ queryKey: contentKeys.listRoot });
      if (r?.id) router.push(`/content/manage?id=${encodeURIComponent(r.id)}`);
      else alert('변환은 성공했지만 ID를 받지 못했습니다');
    } catch (err) {
      alert(`${channel === 'instagram' ? '인스타' : '페이스북'} 변환 실패: ${errText(err, '변환 오류')}`);
    } finally {
      setConverting(undefined);
    }
  };

  const startAbTest = async (measureDays: AbTestMeasureDays) => {
    if (!contentId || abStarting) return;
    setAbStarting(true);
    setAbError(null);
    const res = await createAbTest({ source_content_id: contentId, measure_days: measureDays });
    if (res.error) {
      setAbStarting(false);
      setAbError(res.error.message ?? 'A/B 테스트 시작에 실패했습니다');
      return;
    }
    router.push(`/ab-test/${res.data.id}`);
  };

  return { publish, publishing, convert, converting, startAbTest, abStarting, abError };
}
