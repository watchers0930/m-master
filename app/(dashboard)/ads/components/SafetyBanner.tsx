// app/(dashboard)/ads/components/SafetyBanner.tsx
// 안전 경보 페이지 배너(최종 판정 B1, 설계서 §5.4 "대시보드에 배지로 함께 표시"): 개요의 최근 48시간 경보(메일 미발송 포함)와
// 오래된 감시 스냅샷을 맨 위에 보인다. 끄기 실패·감시 불가는 urgent(붉게 크게). 문구 규칙은 lib/api/ads-safety.ts.
'use client';

import { safetyNotices } from '@/lib/api/ads-safety';
import type { AdGuardSnapshotDTO, AdSafetyAlertDTO } from '@/types/ads';
import { Notice } from './ui';

export function SafetyBanner({ alerts, snapshot }: { alerts: AdSafetyAlertDTO[]; snapshot: AdGuardSnapshotDTO }) {
  const items = safetyNotices(alerts, snapshot);
  if (items.length === 0) return null;
  return (
    <div role="region" aria-label="광고 안전 경보" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((n, i) => (
        <Notice key={i} view={{ message: n.message, urgent: n.urgent, reload: false }} tone="warn" />
      ))}
    </div>
  );
}
