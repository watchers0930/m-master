// hooks/useCafeTargets.ts
// 네이버 카페 타겟 CRUD 상태와 /api/cafe-targets 호출(POST/DELETE/PUT/PATCH).
'use client';

import { useState, useCallback } from 'react';
import type { CafeTargetData } from '@/components/channels/types';

export function useCafeTargets(initialTargets?: CafeTargetData[]) {
  // 카페 타겟 상태
  const [targets, setTargets] = useState<CafeTargetData[]>(initialTargets ?? []);
  const [targetForm, setTargetForm] = useState({ name: '', clubId: '', menuId: '' });
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', clubId: '', menuId: '' });

  // ── 카페 타겟 핸들러 ──
  const handleAddTarget = useCallback(async () => {
    if (!targetForm.name || !targetForm.clubId || !targetForm.menuId) {
      setTargetError('모든 필드를 입력하세요');
      return;
    }
    setTargetLoading(true);
    setTargetError('');
    try {
      const res = await fetch('/api/cafe-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetForm),
      });
      const json = await res.json();
      if (!res.ok) { setTargetError(json.error?.message ?? '추가 실패'); return; }
      setTargets(prev => [...prev, json.data]);
      setTargetForm({ name: '', clubId: '', menuId: '' });
    } catch { setTargetError('네트워크 오류'); }
    finally { setTargetLoading(false); }
  }, [targetForm]);

  const handleDeleteTarget = useCallback(async (id: string) => {
    if (!confirm('이 카페 타겟을 삭제하시겠습니까?')) return;
    try {
      await fetch('/api/cafe-targets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setTargets(prev => prev.filter(t => t.id !== id));
    } catch { setTargetError('삭제 실패'); }
  }, []);

  const handleStartEdit = useCallback((t: CafeTargetData) => {
    setEditingId(t.id);
    setEditForm({ name: t.name, clubId: t.clubId, menuId: t.menuId });
    setTargetError('');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditForm({ name: '', clubId: '', menuId: '' });
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editForm.name || !editForm.clubId || !editForm.menuId) {
      setTargetError('모든 필드를 입력하세요');
      return;
    }
    setTargetLoading(true);
    setTargetError('');
    try {
      const res = await fetch('/api/cafe-targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...editForm }),
      });
      const json = await res.json();
      if (!res.ok) { setTargetError(json.error?.message ?? '수정 실패'); return; }
      setTargets(prev => prev.map(t => t.id === editingId ? { ...t, ...json.data } : t));
      setEditingId(null);
      setEditForm({ name: '', clubId: '', menuId: '' });
    } catch { setTargetError('네트워크 오류'); }
    finally { setTargetLoading(false); }
  }, [editingId, editForm]);

  const handleToggleDefault = useCallback(async (id: string, isDefault: boolean) => {
    try {
      const res = await fetch('/api/cafe-targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isDefault }),
      });
      const json = await res.json();
      if (res.ok) setTargets(json.data);
    } catch { setTargetError('변경 실패'); }
  }, []);

  return {
    targets, targetForm, setTargetForm, targetLoading, targetError,
    editingId, editForm, setEditForm,
    handleAddTarget, handleDeleteTarget, handleStartEdit, handleCancelEdit, handleSaveEdit, handleToggleDefault,
  };
}
