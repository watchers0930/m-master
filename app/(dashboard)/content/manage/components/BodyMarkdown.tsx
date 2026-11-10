// 콘텐츠 관리 미리보기 공용 마크다운 렌더러 (ContentBodyPreview·ChannelPayloadPreview 공용, 표시 전용).
import { parseMarkdown, renderInline } from '@/app/(dashboard)/content/create/components/ContentPreview';

// 본문을 parseMarkdown 기반으로 렌더 — h1/h2/h3/li/blockquote/table/img-placeholder/p 모두 처리
// dropPlaceholders: 발행기가 [이미지] 마커를 버리는 채널(네이버 카페)은 마커를 표시하지 않는다.
export function renderBodyWithImages(text: string, bodyImageUrls: string[], dropPlaceholders = false) {
  const blocks = parseMarkdown(text);
  let imgIdx = 0;
  return blocks.map((block, i) => {
    if (block.type === 'img-placeholder') {
      if (dropPlaceholders) return null;
      const myIdx = imgIdx++;
      const url = bodyImageUrls[myIdx];
      if (url) {
        return (
          <figure key={i} style={{ margin: '12px 0' }}>
            <img
              src={url}
              alt={block.text}
              style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}
            />
            <figcaption style={{ fontSize: 12, color: 'var(--sub)', textAlign: 'center', marginTop: 4, fontStyle: 'italic' }}>
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
            <p style={{ fontSize: 12, color: 'var(--sub)', fontWeight: 600, margin: 0 }}>이미지</p>
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
        <span style={{ color: 'var(--blue-400)', marginTop: 3, flexShrink: 0, fontSize: 12 }}>●</span>
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
