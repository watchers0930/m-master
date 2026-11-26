// app/(dashboard)/seo-audit/hooks/use-auto-resume.ts
// 진단 자동 이어가기(규칙은 lib/seo/auto-resume.ts). 대장이 이 화면에서 직접 실행·재개한 진단만 이어간다(예전 진단을 저절로 진행하지 않음).
// - 한 번에 한 요청만(앞 요청이 끝난 뒤 대기), 진행이 있으면 3초 뒤·없으면 6·12·20초로 늘린다.
// - 멈춤: 진행 중이 아님 · 남은 작업 없음 · 15분 경과 · 오류 · 대장이 '멈추기' · 화면을 떠남. 창이 가려지면 쉬었다가 다시 보이면 이어간다.
// - 화면을 닫거나 멈추면: 서버 재개 크론(15분)은 이미 보낸 작업의 결과만 받아 온다(collectOnly — 안 보낸 작업은 보내지 않음).
//   남은 작업은 다시 '진행 중 실행 재개'로 이어가야 한다.
// - 언마운트 뒤 늦게 도착한 실행·재개 응답이 start()를 불러도 시작하지 않는다(codex HIGH). 숨김 대기 리스너는 멈춤·언마운트 때 뗀다.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeoAuditDTO } from '@/types/seo';
import { AUTO_RESUME_LIMIT_MS, AUTO_RESUME_MIN_MS, nextDelay, progressSignature, shouldContinue } from '@/lib/seo/auto-resume';

type Resume = (auditId: string) => Promise<SeoAuditDTO>;
export type AutoResumeState = { running: boolean; auditId: string | null; stoppedReason: 'done' | 'timeout' | 'error' | 'manual' | null; error: string | null };

export function useAutoResume(resume: Resume, onAudit: (audit: SeoAuditDTO) => void) {
  const [state, setState] = useState<AutoResumeState>({ running: false, auditId: null, stoppedReason: null, error: null });
  const run = useRef(0); // 실행 세대 — 새로 시작·멈추기·언마운트하면 이전 루프는 스스로 끝난다
  const mounted = useRef(false);
  const detach = useRef<(() => void) | null>(null); // 숨김 대기 리스너 해제
  const resumeRef = useRef(resume);
  const onAuditRef = useRef(onAudit);
  useEffect(() => { resumeRef.current = resume; onAuditRef.current = onAudit; });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; run.current += 1; detach.current?.(); detach.current = null; };
  }, []);

  const stop = useCallback((reason: AutoResumeState['stoppedReason'] = 'manual', error: string | null = null) => {
    run.current += 1;
    detach.current?.();
    detach.current = null;
    if (mounted.current) setState({ running: false, auditId: null, stoppedReason: reason, error });
  }, []);

  const start = useCallback((audit: SeoAuditDTO) => {
    if (!mounted.current || !shouldContinue(audit)) return;
    const gen = ++run.current;
    const started = Date.now();
    setState({ running: true, auditId: audit.id, stoppedReason: null, error: null });
    const visible = () => new Promise<void>((res) => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') return res();
      const off = () => { document.removeEventListener('visibilitychange', on); detach.current = null; };
      const on = () => { if (document.visibilityState === 'visible') { off(); res(); } };
      detach.current = off;
      document.addEventListener('visibilitychange', on);
    });
    void (async () => {
      let delay = AUTO_RESUME_MIN_MS, sig = progressSignature(audit);
      for (;;) {
        await new Promise((r) => setTimeout(r, delay));
        if (gen !== run.current) return; // 멈춤·언마운트 뒤 숨김 리스너를 새로 걸지 않게(codex 2차 LOW)
        await visible();
        if (gen !== run.current) return;
        if (Date.now() - started > AUTO_RESUME_LIMIT_MS) return stop('timeout');
        let next: SeoAuditDTO;
        try {
          next = await resumeRef.current(audit.id);
        } catch (e) {
          if (gen === run.current) stop('error', e instanceof Error ? e.message : '요청을 처리하지 못했습니다');
          return;
        }
        if (gen !== run.current) return;
        onAuditRef.current(next);
        if (!shouldContinue(next)) return stop('done');
        const nextSig = progressSignature(next);
        delay = nextDelay(nextSig !== sig, delay);
        sig = nextSig;
      }
    })();
  }, [stop]);

  return { ...state, start, stop };
}
