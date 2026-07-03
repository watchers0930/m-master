'use client';

import { useRef, useState } from 'react';

const FONT_SIZES = [10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32];
const COLORS = ['#000000', '#1e293b', '#ef4444', '#f97316', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];
const BG_COLORS = ['transparent', '#fef08a', '#bbf7d0', '#bfdbfe', '#fce7f3', '#fed7aa', '#e0e7ff'];

const EMOJI_GROUPS = [
  { label: '표정', items: ['😀','😂','😍','😊','😎','😢','😭','🤔','😅','🙏','😆','😏','😜','🥹','😤'] },
  { label: '손/몸', items: ['👍','👎','👏','🙌','🤝','💪','✌️','🤞','👀','💯','🔥','✨','💥','⚡','🎯'] },
  { label: '기호', items: ['✅','❌','⭐','💡','📌','📍','🔑','🔒','🔔','📢','💬','💭','📎','✏️','🖊️'] },
  { label: '비즈니스', items: ['📊','📈','📉','📋','💰','💵','🏆','🎉','🎊','🚀','🌟','💎','🎁','📦','🛒'] },
];

const TABLE_MAX = 6;

interface Props {
  onExecCommand: (cmd: string, value?: string) => void;
  onInsertImage: () => void;
  onInsertHtml: (html: string) => void;
}

export function EditorToolbar({ onExecCommand, onInsertImage, onInsertHtml }: Props) {
  const [showColors, setShowColors] = useState(false);
  const [showBg, setShowBg] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const [tableHover, setTableHover] = useState<[number, number]>([0, 0]);

  const closeAll = () => { setShowColors(false); setShowBg(false); setShowSizes(false); setShowTable(false); setShowEmoji(false); };

  const btn = (title: string, cmd: string, icon: React.ReactNode) => (
    <button
      key={title}
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onExecCommand(cmd); }}
      style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}
    >
      {icon}
    </button>
  );

  const divider = <div style={{ width: 1, height: 22, background: '#e2e8f0', alignSelf: 'center', margin: '0 2px' }} />;

  const buildTable = (rows: number, cols: number) => {
    const ths = Array(cols).fill(0).map(() => '<th style="border:1px solid #cbd5e1;padding:6px 10px;background:#f8fafc;min-width:60px;"></th>').join('');
    const tds = Array(cols).fill(0).map(() => '<td style="border:1px solid #cbd5e1;padding:6px 10px;min-width:60px;"></td>').join('');
    const headerRow = `<tr>${ths}</tr>`;
    const bodyRows = Array(rows - 1).fill(0).map(() => `<tr>${tds}</tr>`).join('');
    return `<table style="border-collapse:collapse;width:100%;margin:8px 0;"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table><p><br></p>`;
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
      {btn('굵게', 'bold', <b style={{ fontSize: 13 }}>B</b>)}
      {btn('기울임', 'italic', <i style={{ fontSize: 13 }}>I</i>)}
      {btn('밑줄', 'underline', <u style={{ fontSize: 13 }}>U</u>)}
      {divider}
      {btn('왼쪽 정렬', 'justifyLeft', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>)}
      {btn('가운데 정렬', 'justifyCenter', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg>)}
      {btn('오른쪽 정렬', 'justifyRight', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>)}
      {divider}

      {/* 들여쓰기 / 내어쓰기 */}
      {btn('들여쓰기', 'indent',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>
          <polyline points="7 9 10 12 7 15"/>
        </svg>
      )}
      {btn('내어쓰기', 'outdent',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>
          <polyline points="10 9 7 12 10 15"/>
        </svg>
      )}
      {divider}

      {/* 글자색 */}
      <div style={{ position: 'relative' }}>
        <button
          title="글자색"
          onMouseDown={(e) => { e.preventDefault(); setShowColors(v => !v); setShowBg(false); setShowSizes(false); setShowTable(false); setShowEmoji(false); }}
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
          onMouseDown={(e) => { e.preventDefault(); setShowBg(v => !v); setShowColors(false); setShowSizes(false); setShowTable(false); setShowEmoji(false); }}
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
          onMouseDown={(e) => { e.preventDefault(); setShowSizes(v => !v); setShowColors(false); setShowBg(false); setShowTable(false); setShowEmoji(false); }}
          style={{ height: 30, padding: '0 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}
        >크기 ▾</button>
        {showSizes && (
          <div style={{ position: 'absolute', top: 34, left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 4, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,.1)', minWidth: 80 }}>
            {FONT_SIZES.map(s => (
              <div key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const sel = window.getSelection();
                  if (sel && sel.rangeCount && !sel.isCollapsed) {
                    const range = sel.getRangeAt(0);
                    const span = document.createElement('span');
                    span.style.fontSize = `${s}px`;
                    try { range.surroundContents(span); } catch { document.execCommand('insertHTML', false, `<span style="font-size:${s}px">${sel.toString()}</span>`); }
                  } else {
                    document.execCommand('insertHTML', false, `<span style="font-size:${s}px">&#8203;</span>`);
                  }
                  setShowSizes(false);
                }}
                style={{ padding: '4px 12px', cursor: 'pointer', fontSize: Math.min(s, 14), borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >{s}px</div>
            ))}
          </div>
        )}
      </div>

      {divider}

      {/* 이미지 */}
      <button
        title="이미지 삽입"
        onMouseDown={(e) => { e.preventDefault(); closeAll(); onInsertImage(); }}
        style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>

      {/* 링크 */}
      {btn('링크', 'createLink', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>)}

      {divider}

      {/* 테이블 생성 */}
      <div style={{ position: 'relative' }}>
        <button
          title="테이블 삽입"
          onMouseDown={(e) => { e.preventDefault(); setShowTable(v => !v); setShowColors(false); setShowBg(false); setShowSizes(false); setShowEmoji(false); }}
          style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
        {showTable && (
          <div style={{ position: 'absolute', top: 34, left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, zIndex: 20, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              {tableHover[0] > 0
                ? `${tableHover[0]}행 × ${tableHover[1]}열`
                : '행·열 선택'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TABLE_MAX}, 18px)`, gap: 2 }}>
              {Array.from({ length: TABLE_MAX * TABLE_MAX }, (_, i) => {
                const row = Math.floor(i / TABLE_MAX) + 1;
                const col = (i % TABLE_MAX) + 1;
                const active = row <= tableHover[0] && col <= tableHover[1];
                return (
                  <div key={i}
                    onMouseEnter={() => setTableHover([row, col])}
                    onMouseLeave={() => setTableHover([0, 0])}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (row > 0 && col > 0) {
                        onInsertHtml(buildTable(row, col));
                        setShowTable(false);
                        setTableHover([0, 0]);
                      }
                    }}
                    style={{ width: 18, height: 18, border: `1px solid ${active ? '#2563eb' : '#e2e8f0'}`, borderRadius: 2, background: active ? '#dbeafe' : '#f8fafc', cursor: 'pointer' }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 이모지 */}
      <div style={{ position: 'relative' }}>
        <button
          title="이모지"
          onMouseDown={(e) => { e.preventDefault(); setShowEmoji(v => !v); setShowColors(false); setShowBg(false); setShowSizes(false); setShowTable(false); }}
          style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 16 }}
        >😊</button>
        {showEmoji && (
          <div style={{ position: 'absolute', top: 34, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, zIndex: 20, boxShadow: '0 4px 16px rgba(0,0,0,.12)', width: 240 }}>
            {/* 탭 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {EMOJI_GROUPS.map((g, i) => (
                <button key={g.label}
                  onMouseDown={(e) => { e.preventDefault(); setEmojiTab(i); }}
                  style={{ flex: 1, padding: '3px 0', fontSize: 11, border: 'none', borderRadius: 6, background: emojiTab === i ? '#dbeafe' : 'transparent', color: emojiTab === i ? '#2563eb' : '#64748b', cursor: 'pointer', fontWeight: emojiTab === i ? 700 : 400 }}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {/* 이모지 그리드 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {EMOJI_GROUPS[emojiTab].items.map(emoji => (
                <button key={emoji}
                  onMouseDown={(e) => { e.preventDefault(); onInsertHtml(emoji); setShowEmoji(false); }}
                  style={{ width: 30, height: 30, border: '1px solid transparent', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >{emoji}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
