// components/channels/CafeTargetList.tsx
// 네이버 카페 타겟 관리 UI(등록 목록·인라인 수정·추가 폼). 상태·호출은 useCafeTargets가 담당.
'use client';

import type { useCafeTargets } from '@/hooks/useCafeTargets';
import { inputStyle } from './inputStyle';

type Props = ReturnType<typeof useCafeTargets>;

export default function CafeTargetList({
  targets, targetForm, setTargetForm, targetLoading, targetError, editingId, editForm, setEditForm,
  handleAddTarget, handleDeleteTarget, handleStartEdit, handleCancelEdit, handleSaveEdit, handleToggleDefault,
}: Props) {
  return (
    <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--border2)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginTop: 14, marginBottom: 8 }}>카페 타겟 관리</p>
      <p style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 10 }}>같은 네이버 계정으로 가입된 여러 카페에 글을 발행할 수 있습니다.</p>

      {/* 등록된 타겟 목록 */}
      {targets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {targets.map(t => editingId === t.id ? (
            <div key={t.id} style={{ background: 'var(--n50)', borderRadius: 6, padding: '10px', fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>카페 이름</label>
                  <input type="text" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} style={{ ...inputStyle, fontSize: 11 }} autoComplete="off" />
                </div>
                <div style={{ flex: '0 0 100px' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>카페 ID</label>
                  <input type="text" value={editForm.clubId} onChange={e => setEditForm(p => ({ ...p, clubId: e.target.value }))} style={{ ...inputStyle, fontSize: 11 }} autoComplete="off" />
                </div>
                <div style={{ flex: '0 0 100px' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>메뉴 ID</label>
                  <input type="text" value={editForm.menuId} onChange={e => setEditForm(p => ({ ...p, menuId: e.target.value }))} style={{ ...inputStyle, fontSize: 11 }} autoComplete="off" />
                </div>
                <button className="btn btn-primary" style={{ fontSize: 11, padding: '7px 12px', flexShrink: 0 }} onClick={handleSaveEdit} disabled={targetLoading}>
                  {targetLoading ? '저장 중...' : '저장'}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '7px 8px', flexShrink: 0 }} onClick={handleCancelEdit}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--n50)', borderRadius: 6, padding: '8px 10px', fontSize: 12 }}>
              <span style={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>
              <span style={{ fontSize: 12, color: 'var(--sub)', fontFamily: 'monospace' }}>club:{t.clubId} / menu:{t.menuId}</span>
              <button
                onClick={() => handleToggleDefault(t.id, !t.isDefault)}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: t.isDefault ? '#E8F5E9' : 'var(--n100)',
                  color: t.isDefault ? '#2E7D32' : 'var(--sub)',
                }}
              >
                {t.isDefault ? '기본' : '기본 설정'}
              </button>
              <button
                onClick={() => handleStartEdit(t)}
                style={{ fontSize: 12, color: 'var(--blue-600)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px' }}
              >
                수정
              </button>
              <button
                onClick={() => handleDeleteTarget(t.id)}
                style={{ fontSize: 12, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px' }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 카페 추가 폼 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>카페 이름</label>
          <input
            type="text" placeholder="예: 부동산 정보 카페"
            value={targetForm.name} onChange={e => setTargetForm(p => ({ ...p, name: e.target.value }))}
            style={{ ...inputStyle, fontSize: 11 }} autoComplete="off"
          />
        </div>
        <div style={{ flex: '0 0 100px' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>카페 ID</label>
          <input
            type="text" placeholder="숫자"
            value={targetForm.clubId} onChange={e => setTargetForm(p => ({ ...p, clubId: e.target.value }))}
            style={{ ...inputStyle, fontSize: 11 }} autoComplete="off"
          />
        </div>
        <div style={{ flex: '0 0 100px' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 2 }}>메뉴 ID</label>
          <input
            type="text" placeholder="숫자"
            value={targetForm.menuId} onChange={e => setTargetForm(p => ({ ...p, menuId: e.target.value }))}
            style={{ ...inputStyle, fontSize: 11 }} autoComplete="off"
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 11, padding: '7px 12px', flexShrink: 0 }}
          onClick={handleAddTarget}
          disabled={targetLoading}
        >
          {targetLoading ? '추가 중...' : '카페 추가'}
        </button>
      </div>
      {targetError && (
        <div style={{ fontSize: 11, color: '#dc2626', marginTop: 6 }}>{targetError}</div>
      )}
    </div>
  );
}
