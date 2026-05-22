// markdown-parser.tsx — 마크다운 파서 유틸리티 (ContentPreview에서 분리)

import React from 'react';

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
