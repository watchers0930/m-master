'use client';

import { useState } from 'react';
import type { ContentGenerateResponse } from '@/types/api';
import { parseMarkdown, renderInline, type MdBlock } from './markdown-parser';
import { ConvertBtn, PublishBtn, PublishAllBtn, type ImageState } from './PublishButtons';
import { ContentImages } from './ContentImages';

// Re-export for backward compatibility
export type { ImageState } from './PublishButtons';
export { ConvertBtn, PublishBtn } from './PublishButtons';
export { parseMarkdown, renderInline, type MdBlock } from './markdown-parser';

// ── 점수 바 ───────────────────────────────────────────────────────
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

      {/* 본문 미리보기 */}
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
          <PublishAllBtn contentId={result.id} disabled={imageState.publishingChannel !== undefined || imageState.convertingChannel !== undefined} onPublish={imageState.onPublish} />
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

// Re-export ContentImages
export { ContentImages } from './ContentImages';
