'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorToolbar } from './EditorToolbar';
import { mergeCells, splitCell, getCellsInRange } from '@/lib/editor/table-ops';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

interface ResizeState {
  td: HTMLTableCellElement;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  dir: 'col' | 'row';
}

interface CellToolbar {
  fx: number; // fixed viewport X
  fy: number; // fixed viewport Y
  canMerge: boolean;
  canSplit: boolean;
}

const BORDER_HIT = 5; // px — border detection threshold

function getResizeDir(clientX: number, clientY: number, td: HTMLTableCellElement): 'col' | 'row' | null {
  const r = td.getBoundingClientRect();
  if (Math.abs(clientX - r.right) < BORDER_HIT) return 'col';
  if (Math.abs(clientY - r.bottom) < BORDER_HIT) return 'row';
  return null;
}

export function RichEditor({ value, onChange, placeholder = '내용을 입력하세요...' }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isComposing = useRef(false);
  const resizeRef = useRef<ResizeState | null>(null);
  const selectedRef = useRef<HTMLTableCellElement[]>([]);
  const anchorRef = useRef<HTMLTableCellElement | null>(null);

  const [toolbar, setToolbar] = useState<CellToolbar | null>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el || document.activeElement === el) return;
    if (el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  const notifyChange = useCallback(() => {
    const raw = editorRef.current?.innerHTML ?? '';
    // data-sel 속성은 저장 대상이 아니므로 제거
    onChange(raw.replace(/ data-sel="true"/g, ''));
  }, [onChange]);

  // document-level 리사이즈 이벤트
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      if (r.dir === 'col') {
        const w = Math.max(40, r.startW + e.clientX - r.startX);
        r.td.style.width = `${w}px`;
        r.td.style.minWidth = `${w}px`;
      } else {
        const h = Math.max(24, r.startH + e.clientY - r.startY);
        r.td.style.height = `${h}px`;
      }
    };
    const onUp = () => {
      if (resizeRef.current) { resizeRef.current = null; notifyChange(); }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [notifyChange]);

  const handleInput = () => {
    if (isComposing.current) return;
    notifyChange();
  };

  const execCommand = (cmd: string, val?: string) => {
    if (cmd === 'createLink') {
      const url = prompt('링크 URL을 입력하세요:');
      if (!url) return;
      document.execCommand('createLink', false, url);
      editorRef.current?.querySelectorAll<HTMLAnchorElement>('a:not([target])').forEach(a => {
        a.target = '_blank'; a.rel = 'noopener noreferrer';
      });
    } else {
      document.execCommand(cmd, false, val);
    }
    notifyChange();
  };

  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    notifyChange();
  };

  const insertImage = () => imageInputRef.current?.click();

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string;
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, `<img src="${src}" style="max-width:100%;height:auto;border-radius:8px;margin:4px 0;" />`);
      notifyChange();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // --- 셀 선택 관리 ---
  function clearSelection() {
    selectedRef.current.forEach(c => c.removeAttribute('data-sel'));
    selectedRef.current = [];
    anchorRef.current = null;
    setToolbar(null);
  }

  function applySelection(cells: HTMLTableCellElement[]) {
    selectedRef.current.forEach(c => c.removeAttribute('data-sel'));
    cells.forEach(c => c.setAttribute('data-sel', 'true'));
    selectedRef.current = cells;

    if (cells.length === 0) { setToolbar(null); return; }

    let minY = Infinity, totalX = 0;
    cells.forEach(cell => {
      const r = cell.getBoundingClientRect();
      minY = Math.min(minY, r.top);
      totalX += r.left + r.width / 2;
    });

    setToolbar({
      fx: totalX / cells.length,
      fy: Math.max(10, minY - 44),
      canMerge: cells.length >= 2,
      canSplit: cells.length === 1 && (cells[0].colSpan > 1 || cells[0].rowSpan > 1),
    });
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (resizeRef.current) return;
    const td = (e.target as Element).closest('td,th') as HTMLTableCellElement | null;
    const cursor = td ? (getResizeDir(e.clientX, e.clientY, td) === 'col' ? 'col-resize' : getResizeDir(e.clientX, e.clientY, td) === 'row' ? 'row-resize' : '') : '';
    if (editorRef.current) editorRef.current.style.cursor = cursor;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const td = (e.target as Element).closest('td,th') as HTMLTableCellElement | null;
    if (!td) return;
    const dir = getResizeDir(e.clientX, e.clientY, td);
    if (dir) {
      e.preventDefault();
      resizeRef.current = { td, startX: e.clientX, startY: e.clientY, startW: td.offsetWidth, startH: td.offsetHeight, dir };
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    const td = (e.target as Element).closest('td,th') as HTMLTableCellElement | null;
    if (!td) { clearSelection(); return; }

    // Ctrl/Cmd: 개별 토글
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (td.hasAttribute('data-sel')) applySelection(selectedRef.current.filter(c => c !== td));
      else applySelection([...selectedRef.current, td]);
      anchorRef.current = td;
      return;
    }

    // Shift: anchor→현재 범위
    if (e.shiftKey && anchorRef.current) {
      e.preventDefault();
      const table = td.closest('table') as HTMLTableElement | null;
      const anchorTable = anchorRef.current.closest('table') as HTMLTableElement | null;
      if (table && table === anchorTable) applySelection(getCellsInRange(table, anchorRef.current, td));
      else { applySelection([td]); anchorRef.current = td; }
      return;
    }

    // 일반 클릭: 이미 단독 선택된 셀이면 편집 모드(선택 해제), 아니면 선택
    if (selectedRef.current.length === 1 && td.hasAttribute('data-sel')) {
      clearSelection();
    } else {
      applySelection([td]);
      anchorRef.current = td;
    }
  };

  const doMerge = () => {
    const ok = mergeCells(selectedRef.current);
    if (ok) { clearSelection(); notifyChange(); }
  };

  const doSplit = () => {
    if (selectedRef.current.length !== 1) return;
    const ok = splitCell(selectedRef.current[0]);
    if (ok) { clearSelection(); notifyChange(); }
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'visible', background: '#fff', position: 'relative' }}>
      <EditorToolbar onExecCommand={execCommand} onInsertImage={insertImage} onInsertHtml={insertHtml} />
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        data-placeholder={placeholder}
        style={{ minHeight: 440, padding: 20, fontSize: 15, lineHeight: 1.7, outline: 'none', color: '#1e293b', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}
      />
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />

      {/* 셀 조작 툴바 */}
      {toolbar && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={{ position: 'fixed', top: toolbar.fy, left: toolbar.fx - 80, zIndex: 9999, display: 'flex', gap: 4, background: '#1e293b', borderRadius: 8, padding: '4px 6px', boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>
          {toolbar.canMerge && (
            <button onClick={doMerge} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
              병합
            </button>
          )}
          {toolbar.canSplit && (
            <button onClick={doSplit} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
              분리
            </button>
          )}
          <button onClick={clearSelection} style={{ padding: '4px 7px', fontSize: 12, background: 'transparent', color: '#94a3b8', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      )}

      <style>{`
        [contenteditable]:empty:before{content:attr(data-placeholder);color:#94a3b8;pointer-events:none}
        [contenteditable] img{max-width:100%;height:auto}
        [contenteditable] a{color:#2563eb;text-decoration:underline}
        [contenteditable] table{border-collapse:collapse;width:100%;margin:8px 0}
        [contenteditable] td,[contenteditable] th{border:1px solid #cbd5e1;padding:6px 10px;min-width:40px;vertical-align:top;position:relative}
        [contenteditable] th{background:#f8fafc;font-weight:700}
        [contenteditable] td[data-sel],[contenteditable] th[data-sel]{outline:2px solid #2563eb;outline-offset:-2px;background:#dbeafe !important}
      `}</style>
    </div>
  );
}
