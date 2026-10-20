// app/(dashboard)/consulting/components/GenerationPanel.tsx
// 전략 리포트 생성 패널: 월 마케팅 예산(선택) 입력 + 비용 발생 명시 + 생성 실행.
// POST /api/consulting 는 저장된 SEO/GEO 진단을 종합해 전략을 1회 생성한다(설계 §1.3).
// 멱등은 서버가 inputSnapshotHash 로 관리 → 프론트는 동일 본문을 재전송하면 서버가 재사용/충돌 처리(§6.2).
//   · 200/201 completed → onReport(리포트)
//   · 409 generation_in_progress(+reportId) → onPendingReport(reportId, domainId) 후 폴링으로 완료 추적
//   · generation_uncertain(+reportId) → onPendingReport(reportId, domainId) 로 미확정 상세 연결(무과금 GET 확인·운영자 정산 안내, 재시도 없음 §6.3)
//   · 409 data_required → 수집 안내 CTA 표시(§3.3)  · 그 외 코드는 서버 메시지로 안내(§6.6)
// 통화는 market 기본 통화로 고정(서버가 최종 검증) — 프론트는 임의 환산/계산을 하지 않는다(§4.2).
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Market, ConsultingReportDTO } from '../types';
import { MARKET_CURRENCY, CURRENCY_SYMBOL } from '../constants';
import { ConsultingApiError, type CreateReportBody } from '../api';
import { useCreateReport } from '../hooks/use-consulting';

interface Props {
  domainId: string;
  market: Market;
  canWrite: boolean;
  /** 생성/재사용 완료 리포트 반영 */
  onReport: (report: ConsultingReportDTO) => void;
  /**
   * 동일 입력이 이미 생성 중(409 in_progress)이거나 비용 미확정(uncertain)인 기존 리포트로 전환.
   * 요청 당시 domainId 를 함께 넘겨, 도메인 전환 뒤 늦게 도착한 응답이 다른 도메인 화면을 덮지 않게 한다(§7).
   */
  onPendingReport: (reportId: string, domainId: string) => void;
}

const GATE_TITLE = 'Starter 플랜부터 사용할 수 있습니다';

/** 수집 CTA — 현재 도메인 문맥을 딥링크로 넘겨 목적 화면이 같은 도메인을 선택하게 한다(§7·지적 2). */
function DataRequiredGuide({ domainId }: { domainId: string }) {
  const q = `?domainId=${encodeURIComponent(domainId)}`;
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 8, background: 'var(--n100)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>종합할 진단 데이터가 아직 없습니다</p>
      <p style={{ fontSize: 11, color: 'var(--sub)', lineHeight: 1.6 }}>
        컨설팅은 새로 수집하지 않고 저장된 SEO·GEO 데이터를 종합합니다. GA4 방문자·상위페이지·트래픽소스는 현재 리포트에 포함되지 않습니다. 아래에서 먼저 SEO 또는 GEO 진단을 수집해 주세요.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link href={`/seo-audit${q}`} className="btn btn-ghost" style={{ padding: '5px 12px' }}>SEO 진단 수집</Link>
        <Link href={`/visibility${q}`} className="btn btn-ghost" style={{ padding: '5px 12px' }}>AI 가시성 수집</Link>
      </div>
    </div>
  );
}

export function GenerationPanel({ domainId, market, canWrite, onReport, onPendingReport }: Props) {
  const createM = useCreateReport();
  const [amountText, setAmountText] = useState('');
  const [err, setErr] = useState<ConsultingApiError | null>(null);

  const currency = MARKET_CURRENCY[market];
  const busy = createM.isPending;

  const handleGenerate = async () => {
    if (!canWrite || busy) return;
    setErr(null);

    const body: CreateReportBody = { domainId, market };
    const trimmed = amountText.trim();
    if (trimmed !== '') {
      const amount = Number(trimmed.replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
        setErr(new ConsultingApiError(400, 'bad_request', '예산은 0 이상의 정수로 입력해 주세요.'));
        return;
      }
      body.monthlyMarketingBudget = { amount, currency };
    }

    try {
      const report = await createM.mutateAsync(body);
      onReport(report);
    } catch (e) {
      if (e instanceof ConsultingApiError) {
        // 이미 생성 중(409)·비용 미확정이면 기존 리포트로 연결(중복 생성 아님). 요청 domainId 를 함께 넘겨
        // 도메인 전환 뒤 늦게 도착한 응답이 다른 도메인 화면을 덮지 않게 한다(§7·지적 1·4).
        if ((e.code === 'generation_in_progress' || e.code === 'generation_uncertain') && e.reportId) {
          onPendingReport(e.reportId, domainId);
          return;
        }
        setErr(e);
      } else {
        setErr(new ConsultingApiError(0, 'unknown', '요청을 처리하지 못했습니다.'));
      }
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="card-title">새 전략 리포트 생성</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 10.5, color: 'var(--sub)', lineHeight: 1.6 }}>
          저장된 <strong style={{ color: 'var(--text)' }}>SEO·GEO 진단</strong>을 종합해 채널 믹스·예산 배분·우선순위 액션을
          한 번에 제안합니다. 새 데이터를 수집하거나 광고를 집행하지 않으며, 전략 생성에만 AI를 1회 호출합니다.
        </p>

        {/* 월 마케팅 예산 (선택) — 금액 배분은 서버가 계산(§4.2) */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600 }}>월 마케팅 예산 (선택)</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--n100)', fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
              {CURRENCY_SYMBOL[currency]} {currency}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              disabled={busy}
              placeholder="예: 3000000 (비우면 비율만 제안)"
              style={{ flex: 1, minWidth: 0, height: 34, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, padding: '0 10px', fontFamily: 'inherit' }}
            />
          </span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>
            통화는 도메인 시장({market}) 기준으로 고정됩니다. 입력 시 채널별 배분 금액을, 비우면 비율만 제안합니다.
          </span>
        </label>

        {/* 비용 경고 (설계 §6.1: 생성만 유료 — 조회는 무과금) */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', borderRadius: 7, background: 'var(--amber-100)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber-700)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p style={{ fontSize: 11, color: 'var(--amber-700)' }}>
            생성 시 AI 전략 비용이 1회 발생하며 월 비용 한도에서 차감됩니다. 동일 데이터로 이미 생성한 리포트가 있으면 비용 없이 재사용됩니다. 조회는 과금되지 않습니다.
          </p>
        </div>

        {/* 에러: data_required 는 수집 CTA, 그 외는 서버 메시지 (설계 §6.6) */}
        {err && err.code === 'data_required' && <DataRequiredGuide domainId={domainId} />}
        {err && err.code !== 'data_required' && (
          <p role="alert" style={{ fontSize: 11.5, color: '#dc2626' }}>{err.message}</p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ opacity: canWrite ? 1 : 0.5 }}
            disabled={!canWrite || busy}
            title={canWrite ? undefined : GATE_TITLE}
            onClick={handleGenerate}
          >
            {busy ? '생성 중…' : '전략 리포트 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
