'use client';

import { useEffect, useRef } from 'react';
import { EditorToolbar } from './EditorToolbar';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function RichEditor({ value, onChange, placeholder = '내용을 입력하세요...' }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isComposing = useRef(false);

  // 외부 value 변경 시 동기화 (포커스 없을 때만)
  useEffect(() => {
    const el = editorRef.current;
    if (!el || document.activeElement === el) return;
    if (el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  const handleInput = () => {
    if (isComposing.current) return;
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const execCommand = (cmd: string, val?: string) => {
    if (cmd === 'createLink') {
      const url = prompt('링크 URL을 입력하세요:');
      if (!url) return;
      document.execCommand('createLink', false, url);
      const links = editorRef.current?.querySelectorAll<HTMLAnchorElement>('a:not([target])');
      links?.forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    } else {
      document.execCommand(cmd, false, val);
    }
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const insertImage = () => imageInputRef.current?.click();

  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, `<img src="${src}" style="max-width:100%;height:auto;border-radius:8px;margin:4px 0;" />`);
      onChange(editorRef.current?.innerHTML ?? '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      <EditorToolbar onExecCommand={execCommand} onInsertImage={insertImage} onInsertHtml={insertHtml} />
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        data-placeholder={placeholder}
        style={{ minHeight: 440, padding: 20, fontSize: 15, lineHeight: 1.7, outline: 'none', color: '#1e293b' }}
      />
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />
      <style>{`
        [contenteditable]:empty:before{content:attr(data-placeholder);color:#94a3b8;pointer-events:none}
        [contenteditable] img{max-width:100%;height:auto}
        [contenteditable] a{color:#2563eb;text-decoration:underline}
        [contenteditable] table{border-collapse:collapse;width:100%}
        [contenteditable] td,[contenteditable] th{border:1px solid #cbd5e1;padding:4px 8px}
        [contenteditable] th{background:#f8fafc}
      `}</style>
    </div>
  );
}
