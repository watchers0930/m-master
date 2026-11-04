// 콘텐츠 본문 미리보기 — 점수·키워드·대표 이미지·본문 (기존 ContentDetailPanel 에서 이전, 표시 전용).
// 본문은 저장된 text_body 그대로 렌더한다. 전략 근거 수치는 여기 주입하지 않는다(설계 §6).
import type { Content } from '@/types/db';
import { parseMarkdown, renderInline } from '@/app/(dashboard)/content/create/components/ContentPreview';

// 본문을 parseMarkdown 기반으로 렌더 — h1/h2/h3/li/blockquote/table/img-placeholder/p 모두 처리
function renderBodyWithImages(text: string, bodyImageUrls: string[]) {
  const blocks = parseMarkdown(text);
  let imgIdx = 0;
  return blocks.map((block, i) => {
    if (block.type === 'img-placeholder') {
      const myIdx = imgIdx++;
      const url = bodyImageUrls[myIdx];
      if (url) {
        return (
          <figure key={i} style={{ margin: '12px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={block.text}
              style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}
            />
            <figcaption style={{ fontSize: 10.5, color: 'var(--sub)', textAlign: 'center', marginTop: 4, fontStyle: 'italic' }}>
              {block.text}
            </figcaption>
          </figure>
        );
      }
      return (
        <div key={i} style={{ border: '1.5px dashed var(--border)', borderRadius: 6, padding: '14px 12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--n400, #94a3b8)" strokeWidth="1.6" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>
          </svg>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600, margin: 0 }}>이미지</p>
            <p style={{ fontSize: 11.5, color: 'var(--text)', fontStyle: 'italic', margin: '2px 0 0', lineHeight: 1.4 }}>{block.text}</p>
          </div>
        </div>
      );
    }
    if (block.type === 'h1') return <h1 key={i} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, margin: '10px 0 6px' }}>{renderInline(block.text)}</h1>;
    if (block.type === 'h2') return <h2 key={i} style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue-700)', marginTop: 10, marginBottom: 4, lineHeight: 1.4 }}>{renderInline(block.text)}</h2>;
    if (block.type === 'h3') return <h3 key={i} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginTop: 6, marginBottom: 2, lineHeight: 1.4 }}>{renderInline(block.text)}</h3>;
    if (block.type === 'li') return (
      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '2px 0' }}>
        <span style={{ color: 'var(--blue-400)', marginTop: 3, flexShrink: 0, fontSize: 10 }}>●</span>
        <p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7, margin: 0 }}>{renderInline(block.text)}</p>
      </div>
    );
    if (block.type === 'blockquote') return (
      <div key={i} style={{ borderLeft: '3px solid var(--blue-300)', paddingLeft: 10, margin: '6px 0' }}>
        <p style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.7, fontStyle: 'italic', margin: 0 }}>{renderInline(block.text)}</p>
      </div>
    );
    if (block.type === 'table') return (
      <div key={i} style={{ overflowX: 'auto', margin: '10px 0' }}>
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
    if (block.type === 'p') return <p key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, margin: '4px 0' }}>{renderInline(block.text)}</p>;
    return null;
  });
}

const SCORE_KEYS = [
  { key: 'seo', label: 'SEO' },
  { key: 'readability', label: '가독성' },
  { key: 'brand', label: '브랜드' },
  { key: 'legal', label: '법률' },
] as const;

export default function ContentBodyPreview({ data }: { data: Content }) {
  return (
    <>
      {/* 점수 상세 */}
      {data.scores && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 12, background: 'var(--n50)', borderRadius: 8 }}>
          {SCORE_KEYS.map((s) => (
            <div key={s.key} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 10.5, color: 'var(--sub)', margin: 0 }}>{s.label}</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '2px 0 0' }}>{data.scores![s.key] ?? '—'}</p>
            </div>
          ))}
        </div>
      )}

      {/* 키워드 */}
      {data.keywords && data.keywords.length > 0 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>키워드</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {data.keywords.map((k) => (
              <span key={k} style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontSize: 11, background: 'var(--blue-100)', color: 'var(--blue-600)' }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 이미지 */}
      {data.image_url && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>이미지</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.image_url} alt={data.topic} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
      )}

      {/* 본문 */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>본문</p>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--n50)', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7, wordBreak: 'break-word' }}>
          {data.text_body
            ? renderBodyWithImages(data.text_body, data.body_image_urls ?? [])
            : <span style={{ color: 'var(--sub)' }}>본문이 없습니다</span>}
        </div>
      </div>
    </>
  );
}
