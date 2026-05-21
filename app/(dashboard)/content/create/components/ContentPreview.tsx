'use client';

import { useState } from 'react';
import type { ContentGenerateResponse } from '@/types/api';

// ── 공유 타입 ─────────────────────────────────────────────────────
export interface ImageState {
  deletedImgIdx: Set<number>;
  thumbnailDeleted: boolean;
  onDeleteImg: (i: number) => void;
  onDeleteThumbnail: () => void;
  // 본문 이미지 개별 재생성 (Unsplash 검색 다시)
  regeneratingIdx?: Set<number>;
  onRegenImg?: (imgIdx: number, description: string) => void;
  // 인스타/페이스북 변환
  convertingChannel?: 'instagram' | 'facebook';
  onConvert?: (channel: 'instagram' | 'facebook', contentId: string) => void;
  // 인스타/페이스북 즉시 발행 (Graph API)
  publishingChannel?: 'instagram' | 'facebook';
  onPublish?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}

// 변환 버튼 (인스타/페이스북)
export function ConvertBtn({
  channel,
  contentId,
  disabled,
  loading,
  onClick,
}: {
  channel: 'instagram' | 'facebook';
  contentId: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}) {
  const label = channel === 'instagram' ? '인스타 변환' : '페이스북 변환';
  const bg = channel === 'instagram'
    ? 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'
    : '#1877f2';
  return (
    <button
      onClick={() => onClick?.(channel, contentId)}
      disabled={disabled || !onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 13px', borderRadius: 7,
        fontSize: 12, fontWeight: 600,
        border: 'none', cursor: disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        background: disabled ? 'var(--n200)' : bg,
        color: '#fff',
        opacity: disabled && !loading ? 0.6 : 1,
      }}
    >
      {loading ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      ) : channel === 'instagram' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
        </svg>
      )}
      {loading ? '변환 중...' : label}
    </button>
  );
}

// 즉시 발행 버튼 (Graph API)
export function PublishBtn({
  channel,
  contentId,
  disabled,
  loading,
  onClick,
}: {
  channel: 'instagram' | 'facebook';
  contentId: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (channel: 'instagram' | 'facebook', contentId: string) => void;
}) {
  const label = channel === 'instagram' ? '인스타 발행' : '페북 발행';
  const baseBg = channel === 'instagram'
    ? 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'
    : '#1877f2';
  const confirmMsg = `${channel === 'instagram' ? '인스타그램' : '페이스북'}에 즉시 발행하시겠습니까?\n\n발행은 취소할 수 없습니다.`;
  return (
    <button
      onClick={() => {
        if (!onClick) return;
        if (window.confirm(confirmMsg)) onClick(channel, contentId);
      }}
      disabled={disabled || !onClick}
      title="Graph API로 즉시 발행 — 토큰이 설정돼 있어야 합니다"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 13px', borderRadius: 7,
        fontSize: 12, fontWeight: 700,
        border: '2px solid #fff',
        boxShadow: '0 0 0 1.5px rgba(0,0,0,0.15)',
        cursor: disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        background: disabled ? 'var(--n200)' : baseBg,
        color: '#fff',
        opacity: disabled && !loading ? 0.6 : 1,
      }}
    >
      {loading ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22,2 15,22 11,13 2,9 22,2"/>
        </svg>
      )}
      {loading ? '발행 중...' : label}
    </button>
  );
}

// ── 마크다운 파서 ─────────────────────────────────────────────────
export type MdBlock =
  | { type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'blockquote' | 'img-placeholder'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

// `| a | b | c |` 형태 1행을 셀 배열로 변환. 시작/끝 파이프 trim.
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map(c => c.trim());
}

// `|---|---|...` 또는 `|:--|--:|` 같은 separator 행 판별
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return false;
  const cells = splitTableRow(t);
  if (cells.length < 2) return false;
  return cells.every(c => /^:?-{3,}:?$/.test(c));
}

export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { i++; continue; }

    // 테이블: 현재 행이 |...| 이고 다음 비공백 행이 separator면 테이블 시작
    if (line.startsWith('|') && line.endsWith('|') && line.indexOf('|', 1) > 0) {
      // 다음 비공백 줄 찾기
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
      if (nextIdx < lines.length && isTableSeparator(lines[nextIdx])) {
        const headers = splitTableRow(line);
        const rows: string[][] = [];
        let j = nextIdx + 1;
        while (j < lines.length) {
          const rowLine = lines[j].trim();
          if (rowLine === '') { j++; continue; }
          if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break;
          rows.push(splitTableRow(rowLine));
          j++;
        }
        blocks.push({ type: 'table', headers, rows });
        i = j;
        continue;
      }
    }

    if (line.startsWith('### ')) blocks.push({ type: 'h3', text: line.slice(4) });
    else if (line.startsWith('## '))  blocks.push({ type: 'h2', text: line.slice(3) });
    else if (line.startsWith('# '))   blocks.push({ type: 'h1', text: line.slice(2) });
    else if (line.startsWith('> '))   blocks.push({ type: 'blockquote', text: line.slice(2) });
    else if (line.startsWith('- ') || line.startsWith('* ')) blocks.push({ type: 'li', text: line.slice(2) });
    else if (/^\[이미지:/.test(line)) blocks.push({ type: 'img-placeholder', text: line.replace(/^\[이미지:\s*/, '').replace(/\]$/, '') });
    else blocks.push({ type: 'p', text: line });
    i++;
  }
  return blocks;
}

export function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 700, color: 'var(--text)' }}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'var(--blue-500)' : score >= 60 ? 'var(--amber-500)' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--sub)', width: 52, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, width: 24, textAlign: 'right', color, fontFamily: 'SCoreDream, Paperlogy, sans-serif' }}>{score}</span>
    </div>
  );
}

function ImgActionBtns({
  onUpload,
  onRegen,
  onEdit,
  onDelete,
  regenDisabled,
}: {
  onUpload: (file: File) => void;
  onRegen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  regenDisabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--sub)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        업로드
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { onUpload(file); e.target.value = ''; }
          }}
        />
      </label>
      <button onClick={onRegen} disabled={regenDisabled} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: regenDisabled ? 'var(--sub)' : 'var(--blue-600)', background: regenDisabled ? 'var(--n100)' : 'var(--blue-50)', border: `1px solid ${regenDisabled ? 'var(--border)' : 'var(--blue-200)'}`, borderRadius: 4, padding: '3px 8px', cursor: regenDisabled ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: regenDisabled ? 'spin 1s linear infinite' : undefined }}><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
        재생성
      </button>
      <button onClick={onEdit} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--sub)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        편집
      </button>
      <button onClick={onDelete} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        삭제
      </button>
    </div>
  );
}

// ── 2열: 본문 텍스트 + 점수 ───────────────────────────────────────
interface ContentBodyProps {
  result: ContentGenerateResponse;
  imageState: ImageState;
  onReset: () => void;
}

export function ContentBody({ result, imageState, onReset }: ContentBodyProps) {
  const [htmlCopied, setHtmlCopied] = useState(false);
  const avgColor = result.scores.avg >= 80 ? 'var(--blue-500)' : result.scores.avg >= 60 ? 'var(--amber-500)' : '#ef4444';
  const blocks = parseMarkdown(result.text);
  const titleBlock = blocks.find((b): b is { type: 'h1'; text: string } => b.type === 'h1');
  const title = titleBlock?.text ?? '';
  const bodyBlocks = blocks.filter(b => b.type !== 'h1');

  const buildBodyHtml = () => {
    const inlineHtml = (text: string) =>
      text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    let bodyHtml = '';
    let inList = false;
    let dlImgIdx = 0;
    for (const b of blocks) {
      if (b.type === 'li') {
        if (!inList) { bodyHtml += '<ul>\n'; inList = true; }
        bodyHtml += `  <li>${inlineHtml(b.text)}</li>\n`;
      } else {
        if (inList) { bodyHtml += '</ul>\n'; inList = false; }
        if (b.type === 'h1') bodyHtml += `<h1>${inlineHtml(b.text)}</h1>\n`;
        else if (b.type === 'h2') bodyHtml += `<h2>${inlineHtml(b.text)}</h2>\n`;
        else if (b.type === 'h3') bodyHtml += `<h3>${inlineHtml(b.text)}</h3>\n`;
        else if (b.type === 'blockquote') bodyHtml += `<blockquote>${inlineHtml(b.text)}</blockquote>\n`;
        else if (b.type === 'img-placeholder') {
          const url = result.body_image_urls?.[dlImgIdx++];
          if (url) {
            const safeAlt = b.text.replace(/"/g, '&quot;');
            bodyHtml += `<figure><img src="${url}" alt="${safeAlt}" style="max-width:100%;height:auto;border-radius:8px;"><figcaption style="font-size:0.85em;color:#666;text-align:center;font-style:italic;">${inlineHtml(b.text)}</figcaption></figure>\n`;
          } else {
            bodyHtml += `<!-- [이미지: ${b.text}] -->\n`;
          }
        }
        else if (b.type === 'table') {
          bodyHtml += '<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:0.95em;">\n';
          bodyHtml += '  <thead><tr>';
          for (const h of b.headers) {
            bodyHtml += `<th style="border:1px solid #d1d5db;background:#f3f4f6;padding:8px 12px;text-align:left;font-weight:700;">${inlineHtml(h)}</th>`;
          }
          bodyHtml += '</tr></thead>\n  <tbody>';
          for (const row of b.rows) {
            bodyHtml += '\n    <tr>';
            for (const cell of row) {
              bodyHtml += `<td style="border:1px solid #d1d5db;padding:8px 12px;">${inlineHtml(cell)}</td>`;
            }
            bodyHtml += '</tr>';
          }
          bodyHtml += '\n  </tbody>\n</table>\n';
        }
        else if (b.type === 'p') bodyHtml += `<p>${inlineHtml(b.text)}</p>\n`;
      }
    }
    if (inList) bodyHtml += '</ul>\n';
    return bodyHtml;
  };

  const handleDownload = () => {
    const titleText = title || result.topic || 'content';
    const slug = titleText.replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '').toLowerCase();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `blog_${date}_${slug}.html`;
    const bodyHtml = buildBodyHtml();
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titleText}</title>
</head>
<body>
${bodyHtml}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyHtml = async () => {
    const bodyHtml = buildBodyHtml();
    try {
      await navigator.clipboard.writeText(bodyHtml);
      setHtmlCopied(true);
      setTimeout(() => setHtmlCopied(false), 2000);
    } catch (_) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = bodyHtml;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setHtmlCopied(true);
      setTimeout(() => setHtmlCopied(false), 2000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>

      {/* AI 검수 점수 */}
      <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--n50)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>AI 검수 점수</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: avgColor, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 20, padding: '2px 10px', fontFamily: 'SCoreDream, Paperlogy, sans-serif' }}>
            평균 {result.scores.avg}점
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <ScoreBar label="SEO"       score={result.scores.seo} />
          <ScoreBar label="가독성"    score={result.scores.readability} />
          <ScoreBar label="브랜드"    score={result.scores.brand} />
          <ScoreBar label="법적 준수" score={result.scores.legal} />
        </div>
        <p style={{ marginTop: 8, fontSize: 10, color: 'var(--sub)' }}>생성 비용: {result.cost_krw.toLocaleString()}원 (텍스트 + 이미지)</p>
      </div>

      {/* 본문 미리보기 — 이미지는 자리만 표시 */}
      <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
          </svg>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', flex: 1 }}>본문 미리보기</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>{result.text.length.toLocaleString()}자</span>
        </div>
        <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {title && (
            <h1 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, marginBottom: 6 }}>
              {renderInline(title)}
            </h1>
          )}
          {(() => {
            let imgCounter = 0;
            return bodyBlocks.map((block, i) => {
            if (block.type === 'img-placeholder') {
              const myImgIdx = imgCounter++;
              if (imageState.deletedImgIdx.has(i)) return null;
              const url = result.body_image_urls?.[myImgIdx];
              if (url) {
                return (
                  <figure key={i} style={{ margin: '8px 0' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={block.text} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                    <figcaption style={{ fontSize: 10, color: 'var(--sub)', textAlign: 'center', marginTop: 3, fontStyle: 'italic' }}>{block.text}</figcaption>
                  </figure>
                );
              }
              return (
                <div key={i} style={{ border: '1.5px dashed var(--border)', borderRadius: 6, padding: '10px 12px', background: 'var(--n50)', display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--n400)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
                  </svg>
                  <span style={{ fontSize: 10.5, color: 'var(--sub)', fontStyle: 'italic' }}>{block.text}</span>
                </div>
              );
            }
            if (block.type === 'h2') return <h2 key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-700)', marginTop: 8, lineHeight: 1.4 }}>{renderInline(block.text)}</h2>;
            if (block.type === 'h3') return <h3 key={i} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginTop: 4, lineHeight: 1.4 }}>{renderInline(block.text)}</h3>;
            if (block.type === 'li') return (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--blue-400)', marginTop: 2, flexShrink: 0, fontSize: 10 }}>●</span>
                <p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7 }}>{renderInline(block.text)}</p>
              </div>
            );
            if (block.type === 'blockquote') return (
              <div key={i} style={{ borderLeft: '3px solid var(--blue-300)', paddingLeft: 10, margin: '4px 0' }}>
                <p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7, fontStyle: 'italic' }}>{renderInline(block.text)}</p>
              </div>
            );
            if (block.type === 'table') return (
              <div key={i} style={{ overflowX: 'auto', margin: '8px 0' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      {block.headers.map((h, hi) => (
                        <th key={hi} style={{ border: '1px solid var(--border)', background: 'var(--n50)', padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>{renderInline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ border: '1px solid var(--border)', padding: '6px 10px', color: 'var(--sub)', lineHeight: 1.5 }}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            if (block.type === 'p') {
              return <p key={i} style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7 }}>{renderInline(block.text)}</p>;
            }
            return null;
          });
          })()}
        </div>
      </div>

      </div>{/* /스크롤 영역 */}

      {/* 고정 푸터 — 버튼 */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', padding: '12px 0 0' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleDownload} className="btn btn-primary" style={{ fontSize: 12, gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            HTML 다운로드
          </button>
          <button onClick={handleCopyHtml} className="btn btn-ghost" style={{ fontSize: 12, gap: 6, color: htmlCopied ? '#22c55e' : undefined }}>
            {htmlCopied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            )}
            {htmlCopied ? '복사 완료' : 'HTML 복사'}
          </button>
          <ConvertBtn channel="instagram" contentId={result.id} disabled={imageState.convertingChannel !== undefined} loading={imageState.convertingChannel === 'instagram'} onClick={imageState.onConvert} />
          <ConvertBtn channel="facebook" contentId={result.id} disabled={imageState.convertingChannel !== undefined} loading={imageState.convertingChannel === 'facebook'} onClick={imageState.onConvert} />
          <PublishBtn channel="instagram" contentId={result.id} disabled={imageState.publishingChannel !== undefined} loading={imageState.publishingChannel === 'instagram'} onClick={imageState.onPublish} />
          <PublishBtn channel="facebook" contentId={result.id} disabled={imageState.publishingChannel !== undefined} loading={imageState.publishingChannel === 'facebook'} onClick={imageState.onPublish} />
          <button onClick={onReset} className="btn btn-ghost" style={{ fontSize: 12, gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
            </svg>
            다시 생성
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 3열: 이미지 관리 패널 ─────────────────────────────────────────
interface ContentImagesProps {
  result: ContentGenerateResponse;
  imageState: ImageState;
}

export function ContentImages({ result, imageState }: ContentImagesProps) {
  const [thumbErr, setThumbErr] = useState(false);
  const blocks = parseMarkdown(result.text);
  const imgBlocks = blocks.filter((b): b is { type: 'img-placeholder'; text: string } => b.type === 'img-placeholder');
  const titleBlock = blocks.find((b): b is { type: 'h1'; text: string } => b.type === 'h1');
  const title = titleBlock?.text ?? '';

  const visibleCount = imgBlocks.length - imageState.deletedImgIdx.size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 썸네일 */}
      {!imageState.thumbnailDeleted && (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>썸네일</span>
            {result.image_url && !thumbErr
              ? <span style={{ fontSize: 9, color: 'var(--sub)', background: 'var(--n100)', borderRadius: 3, padding: '1px 6px' }}>DALL-E 3</span>
              : <span style={{ fontSize: 9, color: 'var(--amber-600)', background: 'var(--amber-50)', border: '1px solid var(--amber-200)', borderRadius: 3, padding: '1px 6px' }}>이미지 미생성</span>
            }
          </div>
          {result.image_url && !thumbErr ? (
            <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--n50)' }}>
              <img src={result.image_url} alt={title || '생성된 썸네일'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setThumbErr(true)} />
            </div>
          ) : (
            <div style={{ aspectRatio: '16/9', background: 'var(--n50)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1.5px dashed var(--border)', margin: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
              </svg>
              <span style={{ fontSize: 10, color: 'var(--sub)' }}>대표 썸네일 이미지</span>
            </div>
          )}
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--n50)' }}>
            <ImgActionBtns
              onUpload={(file) => alert(`썸네일 업로드: ${file.name} — BE 연동 후 구현`)}
              onRegen={() => alert('썸네일 재생성 — BE 연동 후 구현')}
              onEdit={() => alert('썸네일 편집 — 추후 구현')}
              onDelete={imageState.onDeleteThumbnail}
            />
          </div>
        </div>
      )}

      {/* 본문 이미지 — 2열 그리드 */}
      {imgBlocks.length > 0 && (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>본문 이미지</span>
            <span style={{ fontSize: 10, color: 'var(--sub)' }}>{visibleCount}개</span>
          </div>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              let imgCounter = 0;
              return blocks.map((block, i) => {
                if (block.type !== 'img-placeholder') return null;
                const myImgIdx = imgCounter++;
                const deleted = imageState.deletedImgIdx.has(i);
                const url = result.body_image_urls?.[myImgIdx];
                const isRegenerating = imageState.regeneratingIdx?.has(myImgIdx);
                return (
                  <div key={i} style={{ borderRadius: 6, border: url ? '1px solid var(--border)' : '1.5px dashed var(--border)', overflow: 'hidden', opacity: deleted ? 0.35 : 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--n50)' }}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={block.text} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 16px' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
                          </svg>
                          <span style={{ fontSize: 10, color: 'var(--sub)', textAlign: 'center', lineHeight: 1.5 }}>{block.text}</span>
                        </div>
                      )}
                      {isRegenerating && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-500)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                            <path d="M21 12a9 9 0 11-6.219-8.56"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '4px 8px', background: 'var(--n50)', borderTop: '1px solid var(--border)' }}>
                      <p style={{ fontSize: 9.5, color: 'var(--sub)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }} title={block.text}>{block.text}</p>
                    </div>
                    {!deleted && (
                      <div style={{ padding: '6px 8px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                        <ImgActionBtns
                          onUpload={(file) => alert(`이미지 업로드: ${file.name} — 추후 Storage 연동 필요`)}
                          onRegen={() => imageState.onRegenImg?.(myImgIdx, block.text)}
                          onEdit={() => alert(`"${block.text}" 편집 — 추후 구현`)}
                          onDelete={() => imageState.onDeleteImg(i)}
                          regenDisabled={isRegenerating}
                        />
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
