import type { IdeaDoc, IdeaJob, CalendarEntry } from '@/types/editor';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<{ data: T | null; error: string | null }> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) return { data: null, error: json.error ?? '오류가 발생했습니다.' };
  return { data: json.data ?? json, error: null };
}

export const listEditorDocs = () =>
  apiFetch<IdeaDoc[]>('/api/editor/docs', { cache: 'no-store' });

export const getEditorDoc = (id: string) =>
  apiFetch<IdeaDoc>(`/api/editor/docs/${id}`, { cache: 'no-store' });

export const createEditorDoc = (body: Partial<IdeaDoc>) =>
  apiFetch<IdeaDoc>('/api/editor/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const updateEditorDoc = (id: string, body: Partial<IdeaDoc>) =>
  apiFetch<IdeaDoc>(`/api/editor/docs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteEditorDoc = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/editor/docs/${id}`, { method: 'DELETE' });

export const scheduleEditorDoc = (id: string, scheduledAt: string | null) =>
  apiFetch<IdeaJob>(`/api/editor/docs/${id}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduledAt }),
  });

export const getDocSchedule = (id: string) =>
  apiFetch<IdeaJob | null>(`/api/editor/docs/${id}/schedule`, { cache: 'no-store' });

export const getCalendar = (year: number, month: number) =>
  apiFetch<CalendarEntry[]>(`/api/planner/calendar?year=${year}&month=${month}`, { cache: 'no-store' });

export const createPlanItem = (body: { title: string; scheduledDate: string; category: string }) =>
  apiFetch(`/api/planner/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const updatePlanItem = (id: string, body: { status?: string; title?: string }) =>
  apiFetch(`/api/planner/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deletePlanItem = (id: string) =>
  apiFetch(`/api/planner/schedules/${id}`, { method: 'DELETE' });

export const deletePublishJob = (id: string) =>
  apiFetch(`/api/planner/publish-jobs?id=${id}`, { method: 'DELETE' });
