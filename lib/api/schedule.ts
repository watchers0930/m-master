// lib/api/schedule.ts — 스케줄 API 래퍼 (Supabase 영구 저장)
import type { ApiResponse, ScheduleManualRequest, ScheduleManualResponse } from '@/types/api';
import type { ScheduleSlot, SlotStatus } from '@/types/db';

// ── API 함수 ──────────────────────────────────────────────────────

export async function listSlots(params?: {
  year?: number;
  month?: number;
}): Promise<ApiResponse<ScheduleSlot[]>> {
  const qs = new URLSearchParams();
  if (params?.year)  qs.set('year',  String(params.year));
  if (params?.month) qs.set('month', String(params.month));
  const res = await fetch(`/api/schedule/slots?${qs}`);
  return res.json();
}

export async function createSlot(
  req: ScheduleManualRequest
): Promise<ApiResponse<ScheduleManualResponse>> {
  const res = await fetch('/api/schedule/slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content_id:   req.content_id || null,
      channel:      req.channel,
      scheduled_at: req.scheduled_at,
      status:       'scheduled',
      mode:         'manual',
    }),
  });
  const json = await res.json();
  if (json.error) return { data: null, error: json.error };
  const slot = Array.isArray(json.data) ? json.data[0] : json.data;
  return { data: { slot_id: slot.id }, error: null };
}

export async function patchSlot(
  id: string,
  updates: { scheduled_at?: string; status?: SlotStatus }
): Promise<ApiResponse<ScheduleSlot>> {
  const res = await fetch(`/api/schedule/slot/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteSlot(id: string): Promise<ApiResponse<null>> {
  const res = await fetch(`/api/schedule/slot/${id}`, { method: 'DELETE' });
  return res.json();
}

export interface AiProposal {
  date: string;       // 'YYYY-MM-DD'
  channel: ScheduleSlot['channel'];
  time: string;       // 'HH:MM'
}

export interface AutoScheduleResult {
  proposals: AiProposal[];
  ga4Fallback: boolean;  // true = GA4 실패, 폴백 패턴 사용
  ga4Error?: string;
}

// 날짜 → 주차 버킷 (0~3)
function weekBucket(day: number): number {
  if (day <= 7)  return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

// quota를 n개 버킷에 균등 분배 → 버킷별 목표 건수 배열
function distributeToBuckets(quota: number, n: number): number[] {
  if (n === 0) return [];
  const base  = Math.floor(quota / n);
  const extra = quota % n;
  return Array.from({ length: n }, (_, i) => (i < extra ? base + 1 : base));
}

// GA4 세션 비율 기반 채널별 슬롯 수 산출
// - 채널당 최소 3건 보장 (비율이 낮아도 월 최소 발행 유지)
// - 나머지를 세션 비율로 배분
function calcQuota(
  totals: Record<'blog' | 'instagram' | 'facebook', number>,
  totalSlots: number,
): Record<'blog' | 'instagram' | 'facebook', number> {
  const channels = ['blog', 'instagram', 'facebook'] as const;
  const MIN_PER_CHANNEL = 3;
  const guaranteed = channels.length * MIN_PER_CHANNEL; // 9
  const flex = totalSlots - guaranteed;                  // 7 (16-9)

  const grand = channels.reduce((s, ch) => s + totals[ch], 0);

  // 비율 기반 flex 배분 (세션 0이면 균등)
  const flexRaw = channels.reduce((acc, ch) => {
    acc[ch] = grand > 0 ? Math.round(flex * totals[ch] / grand) : Math.floor(flex / 3);
    return acc;
  }, {} as Record<'blog' | 'instagram' | 'facebook', number>);

  // flex 합계 오차 보정 — 가장 큰 채널에서 조정
  const flexTotal = flexRaw.blog + flexRaw.instagram + flexRaw.facebook;
  const diff = flex - flexTotal;
  if (diff !== 0) {
    const top = [...channels].sort((a, b) => flexRaw[b] - flexRaw[a])[0];
    flexRaw[top] = Math.max(0, flexRaw[top] + diff);
  }

  return {
    blog:      MIN_PER_CHANNEL + flexRaw.blog,
    instagram: MIN_PER_CHANNEL + flexRaw.instagram,
    facebook:  MIN_PER_CHANNEL + flexRaw.facebook,
  };
}

// GA4 방문자 패턴 완전 반영 자동편성
// - 채널별 슬롯 수: GA4 90일 세션 비율 기반 (총 16건/월)
// - 발행 요일: 채널별 GA4 상위 요일
// - 주차 분산: 월간 quota를 4주에 균등 배치
// - 같은 날 여러 채널 허용 (블로그+인스타 동시 발행 가능)
export async function autoSchedule(
  year: number,
  month: number,
  existingSlots: ScheduleSlot[],
): Promise<ApiResponse<AutoScheduleResult>> {
  const TOTAL_MONTHLY_SLOTS = 16;

  // GA4 패턴 + 채널별 세션 합계 조회
  let pattern: Record<'blog' | 'instagram' | 'facebook', number[]> = {
    blog: [], instagram: [], facebook: [],
  };
  let channelTotals: Record<'blog' | 'instagram' | 'facebook', number> | null = null;
  let ga4Fallback = false;
  let ga4Error: string | undefined;

  try {
    const res = await fetch('/api/analytics/ga4-pattern');
    const json = await res.json();
    if (json.ga4_fallback) {
      ga4Fallback = true;
      ga4Error = json.error ?? 'GA4 데이터를 가져올 수 없습니다';
    } else {
      pattern = json.data;
      channelTotals = json.channel_totals;
    }
  } catch (e) {
    ga4Fallback = true;
    ga4Error = e instanceof Error ? e.message : 'GA4 API 연결 실패';
  }

  // 채널별 월간 목표 건수 산출
  const quota = channelTotals
    ? calcQuota(channelTotals, TOTAL_MONTHLY_SLOTS)
    : { blog: 6, instagram: 6, facebook: 4 }; // 폴백 배분

  const channels = ['blog', 'instagram', 'facebook'] as const;

  // 채널별 이미 존재하는 날짜 (같은 채널 중복 방지)
  const existingByChannel: Record<typeof channels[number], Set<string>> = {
    blog:      new Set(),
    instagram: new Set(),
    facebook:  new Set(),
  };
  for (const s of existingSlots) {
    if (s.channel in existingByChannel) {
      existingByChannel[s.channel as typeof channels[number]].add(s.scheduled_at.slice(0, 10));
    }
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  // 채널별 × 버킷별 후보 날짜 수집
  // 같은 채널이 이미 같은 날 등록된 경우만 제외 (타 채널과 날짜 공유는 허용)
  const candidates: Record<typeof channels[number], Map<number, string[]>> = {
    blog:      new Map([[0,[]],[1,[]],[2,[]],[3,[]]]),
    instagram: new Map([[0,[]],[1,[]],[2,[]],[3,[]]]),
    facebook:  new Map([[0,[]],[1,[]],[2,[]],[3,[]]]),
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (dateStr <= today) continue;
    const dow    = new Date(dateStr).getDay();
    const bucket = weekBucket(d);
    for (const ch of channels) {
      if (existingByChannel[ch].has(dateStr)) continue;
      if (pattern[ch].includes(dow)) candidates[ch].get(bucket)!.push(dateStr);
    }
  }

  // 버킷 내 날짜를 요일 기준 오름차순 정렬 (월=1이 먼저, 금=5가 나중)
  // → 버킷 경계가 금요일로 시작하는 경우에도 주초 날짜가 먼저 선택됨
  for (const ch of channels) {
    for (const b of [0, 1, 2, 3] as const) {
      candidates[ch].get(b)!.sort((a, z) => {
        const da = new Date(a).getDay() || 7; // 일(0) → 7로 처리해 맨 뒤로
        const dz = new Date(z).getDay() || 7;
        return da - dz;
      });
    }
  }

  // 채널별 quota를 후보가 있는 버킷에만 균등 분배 후 날짜 선택
  const proposals: AiProposal[] = [];

  for (const ch of channels) {
    // 실제 후보 날짜가 존재하는 버킷만 대상으로 삼음 (이미 지난 버킷 제외)
    const availBuckets = ([0, 1, 2, 3] as const).filter(
      b => (candidates[ch].get(b) ?? []).length > 0,
    );
    if (availBuckets.length === 0) continue;

    const bucketTargets = distributeToBuckets(quota[ch], availBuckets.length);

    for (let i = 0; i < availBuckets.length; i++) {
      const bucket = availBuckets[i];
      const target = bucketTargets[i];
      if (target === 0) continue;
      const dates = candidates[ch].get(bucket) ?? [];
      let picked = 0;
      for (const date of dates) {
        if (picked >= target) break;
        proposals.push({ date, channel: ch, time: '09:00' });
        picked++;
      }
    }
  }

  // 날짜 순 정렬
  proposals.sort((a, b) => a.date.localeCompare(b.date));

  return { data: { proposals, ga4Fallback, ga4Error }, error: null };
}

export async function clearSlots(year: number, month: number): Promise<ApiResponse<null>> {
  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  const res = await fetch(`/api/schedule/slots?${qs}`, { method: 'DELETE' });
  return res.json();
}

export async function applyAiProposals(
  proposals: AiProposal[],
): Promise<ApiResponse<ScheduleSlot[]>> {
  const rows = proposals.map(p => ({
    content_id:   null,
    channel:      p.channel,
    scheduled_at: `${p.date}T${p.time}:00Z`,
    status:       'scheduled',
    mode:         'ai_auto',
  }));

  const res = await fetch('/api/schedule/slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  return res.json();
}
