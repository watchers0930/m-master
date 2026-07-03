'use client';

import { useRef, useState } from 'react';

const FONT_SIZES = [10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32];
const COLORS = ['#000000', '#1e293b', '#ef4444', '#f97316', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];
const BG_COLORS = ['transparent', '#fef08a', '#bbf7d0', '#bfdbfe', '#fce7f3', '#fed7aa', '#e0e7ff'];

interface Props {
  onExecCommand: (cmd: string, value?: string) => void;
  onInsertImage: () => void;
}

export function EditorToolbar({ onExecCommand, onInsertImage }: Props) {
  const [showColors, setShowColors] = useState(false);
  const [showBg, setShowBg] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  const btn = (title: string, cmd: string, icon: React.ReactNode) => (
    <button
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onExecCommand(cmd); }}
      style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}
    >
      {icon}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
      {btn('굵게', 'bold', <b style={{ fontSize: 13 }}>B</b>)}
      {btn('기울임', 'italic', <i style={{ fontSize: 13 }}>I</i>)}
      {btn('밑줄', 'underline', <u style={{ fontSize: 13 }}>U</u>)}
      <div style={{ width: 1, height: 22, background: '#e2e8f0', alignSelf: 'center', margin: '0 2px' }} />
      {btn('왼쪽 정렬', 'justifyLeft', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>)}
      {btn('가운데 정렬', 'justifyCenter', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg>)}
      {btn('오른쪽 정렬', 'justifyRight', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>)}
      <div style={{ width: 1, height: 22, background: '#e2e8f0', alignSelf: 'center', margin: '0 2px' }} />

      {/* 글자색 */}
      <div style={{ position: 'relative' }} ref={colorRef}>
        <button
          title="글자색"
          onMouseDown={(e) => { e.preventDefault(); setShowColors(v => !v); setShowBg(false); setShowSizes(false); }}
          style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
        >A</button>
        {showColors && (
          <div style={{ position: 'absolute', top: 34, left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap', width: 144, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
            {COLORS.map(c => (
              <div key={c} onMouseDown={(e) => { e.preventDefault(); onExecCommand('foreColor', c); setShowColors(false); }}
                style={{ width: 20, height: 20, borderRadius: 4, background: c, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
            ))}
          </div>
        )}
      </div>

      {/* 배경색 */}
      <div style={{ position: 'relative' }}>
        <button
          title="배경색"
          onMouseDown={(e) => { e.preventDefault(); setShowBg(v => !v); setShowColors(false); setShowSizes(false); }}
          style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fef08a', cursor: 'pointer', fontSize: 11 }}
        >형광</button>
        {showBg && (
          <div style={{ position: 'absolute', top: 34, left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap', width: 144, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
            {BG_COLORS.map(c => (
              <div key={c} onMouseDown={(e) => { e.preventDefault(); onExecCommand('hiliteColor', c === 'transparent' ? 'transparent' : c); setShowBg(false); }}
                style={{ width: 20, height: 20, borderRadius: 4, background: c === 'transparent' ? '#f1f5f9' : c, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
            ))}
          </div>
        )}
      </div>

      {/* 폰트 크기 */}
      <div style={{ position: 'relative' }}>
        <button
          title="글자 크기"
          onMouseDown={(e) => { e.preventDefault(); setShowSizes(v => !v); setShowColors(false); setShowBg(false); }}
          style={{ height: 30, padding: '0 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}
        >크기 ▾</button>
        {showSizes && (
          <div style={{ position: 'absolute', top: 34, left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 4, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,.1)', minWidth: 80 }}>
            {FONT_SIZES.map(s => (
              <div key={s} onMouseDown={(e) => { e.preventDefault(); onExecCommand('fontSize', '7'); document.execCommand('styleWithCSS', false, 'true'); document.execCommand('fontSize', false, '7'); const sel = window.getSelection(); if (sel?.rangeCount) { const range = sel.getRangeAt(0); const span = document.createElement('span'); span.style.fontSize = `${s}px`; range.surroundContents(span); } setShowSizes(false); }}
                style={{ padding: '4px 12px', cursor: 'pointer', fontSize: s > 14 ? 14 : s, borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >{s}px</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 22, background: '#e2e8f0', alignSelf: 'center', margin: '0 2px' }} />
      <button
        title="이미지 삽입"
        onMouseDown={(e) => { e.preventDefault(); onInsertImage(); }}
        style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      {btn('링크', 'createLink', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>)}
    </div>
  );
}
