// hooks/useChannelCredentials.ts
// 채널 연결·해제 상태와 /api/channels 호출(POST 저장+검증, DELETE 해제).
// 마스킹은 클라이언트 안전 모듈(@/lib/crypto/mask)만 사용한다 — 서버 전용 crypto를 import하지 않는다.
'use client';

import { useState, useCallback } from 'react';
import { maskSecret } from '@/lib/crypto/mask';
import type { ChannelStatus } from '@/components/channels/types';

export function useChannelCredentials(initial: Record<string, ChannelStatus>) {
  const [statuses, setStatuses] = useState(initial);
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, string>>({});

  const setField = useCallback((channelId: string, key: string, value: string) => {
    setForms(prev => ({ ...prev, [channelId]: { ...prev[channelId], [key]: value } }));
  }, []);

  // ── 연결 ──
  const handleConnect = useCallback(async (channelId: string) => {
    const fields = forms[channelId] ?? {};
    setLoading(prev => ({ ...prev, [channelId]: true }));
    setErrors(prev => ({ ...prev, [channelId]: '' }));
    setSuccess(prev => ({ ...prev, [channelId]: '' }));

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelId, ...fields }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [channelId]: json.error?.message ?? '연결 실패' }));
        return;
      }
      setSuccess(prev => ({ ...prev, [channelId]: json.data?.message ?? '연결 완료' }));
      // 상태 갱신
      const masked: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string' && v.length > 0) {
          masked[k] = maskSecret(v); // 서버(listMaskedCredentials)와 같은 형식
        }
      }
      setStatuses(prev => ({ ...prev, [channelId]: { connected: true, masked } }));
      setForms(prev => ({ ...prev, [channelId]: {} }));
    } catch {
      setErrors(prev => ({ ...prev, [channelId]: '네트워크 오류' }));
    } finally {
      setLoading(prev => ({ ...prev, [channelId]: false }));
    }
  }, [forms]);

  // ── 연결 해제 ──
  const handleDisconnect = useCallback(async (channelId: string) => {
    if (!confirm('이 채널 연결을 해제하시겠습니까?')) return;
    setLoading(prev => ({ ...prev, [channelId]: true }));
    try {
      await fetch('/api/channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelId }),
      });
      setStatuses(prev => ({ ...prev, [channelId]: { connected: false } }));
      setSuccess(prev => ({ ...prev, [channelId]: '' }));
    } catch {
      setErrors(prev => ({ ...prev, [channelId]: '해제 실패' }));
    } finally {
      setLoading(prev => ({ ...prev, [channelId]: false }));
    }
  }, []);

  return { statuses, forms, loading, errors, success, setField, handleConnect, handleDisconnect };
}
