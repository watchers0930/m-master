// app/(dashboard)/consulting/components/ChannelMixCard.tsx
// 채널 믹스 — organic·geo·naver_paid 권고 비율. 비율은 서버가 검증(합=100, 미적용=0)한 값을 그대로 표시한다.
// 미적용 채널(not_applicable, 예: 비한국 market 의 naver_paid)은 비율 0·'해당 없음'으로 구분(설계 §4.2).
'use client';

import type { ChannelRecommendation, EvidenceRef } from '../types';
import { CHANNEL_LABELS, CHANNEL_COLORS, CHANNEL_DESC, renderEvidenceTokens, formatRatio } from '../constants';
import { EvidenceChips } from './EvidenceChips';

interface Props {
  channelMix: ChannelRecommendation[];
  evidenceById: Map<string, EvidenceRef>;
}

export function ChannelMixCard({ channelMix, evidenceById }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
        <span className="card-title">채널 믹스 제안</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {channelMix.map((c) => {
          const applicable = c.applicability === 'applicable';
          const color = CHANNEL_COLORS[c.channel];
          return (
            <div key={c.channel} style={{ opacity: applicable ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{CHANNEL_LABELS[c.channel]}</span>
                <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{CHANNEL_DESC[c.channel]}</span>
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color }}>
                  {applicable ? formatRatio(c.recommendedRatio) : '해당 없음'}
                </span>
              </div>

              {/* 비율 바 — 서버 검증 비율만 표시(재계산 없음) */}
              <div style={{ height: 8, borderRadius: 4, background: 'var(--n100)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${applicable ? Math.max(0, Math.min(100, c.recommendedRatio)) : 0}%`, background: color, borderRadius: 4 }} />
              </div>

              {c.reason && (
                <p style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.6, marginTop: 6 }}>
                  {renderEvidenceTokens(c.reason, evidenceById)}
                </p>
              )}
              <EvidenceChips evidenceIds={c.evidenceIds} evidenceById={evidenceById} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
