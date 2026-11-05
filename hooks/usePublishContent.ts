// hooks/usePublishContent.ts
// 상세 패널·콘텐츠 생성 화면 공용 발행·변환·A/B 시작 핸들러 (기존 ContentDetailPanel 에서 이전, 설계 §6).
// 발행 가능 여부는 서버(isPublishable)가 최종 판정 — 409 사유를 안내하고 상세를 재조회한다.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createAbTest } from '@/lib/api/ab-test';
import type { AbTestMeasureDays } from '@/types/db';
import { publishContent, convertContent, ContentApiError } from '@/lib/api/content';
import {
  publishViaChildContent, CHANNEL_PUBLISH_LABEL as CHANNEL_LABEL, PUBLISH_ERROR_TEXT,
  type ChannelPublishOutcome,
} from '@/lib/api/content-channel-publish';
import type { ConvertChannel, PublishChannel } from '@/types/content-review';
import { contentKeys, refreshContent } from './useContentDetail';

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

  /**
   * 원본(블로그) → 채널 자식 콘텐츠로 발행 (lib/api/content-channel-publish). 결과 안내는 호출부가 한다.
   * 동시에 한 채널씩만 진행 — 진행 중이면 null.
   */
  const publishToChannel = async (
    channel: PublishChannel,
    opts?: { cafeTargetIds?: string[] },
  ): Promise<ChannelPublishOutcome | null> => {
    if (!contentId || publishing) return null;
    setPublishing(channel);
    try {
      return await publishViaChildContent(contentId, channel, opts);
    } finally {
      setPublishing(undefined);
      // 새 자식 콘텐츠·발행 상태가 목록/상세에 바로 보이도록
      await qc.invalidateQueries({ queryKey: contentKeys.listRoot });
    }
  };

  const startAbTest = async (measureDays: AbTestMeasureDays) => {
    if (!contentId || abStarting) return;
    setAbStarting(true);
    setAbError(null);
    try {
      const res = await createAbTest({ source_content_id: contentId, measure_days: measureDays });
      if (res.error) {
        setAbStarting(false);
        setAbError(res.error.message || 'A/B 테스트 시작에 실패했습니다');
        return;
      }
      // 성공 시에는 이동 완료까지 버튼을 잠근 채 둔다(중복 생성 방지)
      router.push(`/ab-test/${res.data.id}`);
    } catch (err) {
      // 네트워크 오류 등 요청 자체 실패 — '시작 중' 에 멈추지 않게 해제
      setAbStarting(false);
      setAbError(err instanceof Error && err.message ? `A/B 테스트 시작에 실패했습니다 — ${err.message}` : 'A/B 테스트 시작에 실패했습니다');
    }
  };

  const clearAbError = () => setAbError(null);

  return { publish, publishing, publishToChannel, convert, converting, startAbTest, abStarting, abError, clearAbError };
}
