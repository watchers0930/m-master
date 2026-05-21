'use client';

import type { Content } from '@/types/db';

interface Props {
  variant: 'a' | 'b';
  content: Content;
}

export default function VariantPreviewPane({ variant, content }: Props) {
  const isA = variant === 'a';

  const badgeBg    = isA ? 'var(--blue-600)'  : 'var(--amber-500)';
  const headerBg   = isA ? 'var(--blue-100)'  : 'var(--amber-100)';
  const label      = `변형 ${variant.toUpperCase()}`;

  const avg = content.scores?.avg;
  const scoreColor = avg !== undefined
    ? (avg >= 80 ? 'var(--green-700)' : avg >= 60 ? 'var(--amber-700)' : '#dc2626')
    : undefined;
  const scoreBg = avg !== undefined
    ? (avg >= 80 ? 'var(--green-100)' : avg >= 60 ? 'var(--amber-100)' : '#fee2e2')
    : undefined;

  // 본문 4줄 truncate (앞 240자)
  const previewText = content.text_body
    ? content.text_body.slice(0, 240) + (content.text_body.length > 240 ? '…' : '')
    : null;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: headerBg,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: badgeBg,
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {variant.toUpperCase()}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          {label}
        </span>
        {avg !== undefined && (
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 10.5,
              fontWeight: 600,
              background: scoreBg,
              color: scoreColor,
            }}
          >
            AI {avg}점
          </span>
        )}
      </div>

      {/* 본문 */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 제목 */}
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.45 }}>
          {content.topic}
        </p>

        {/* 본문 일부 */}
        {previewText ? (
          <p
            style={{
              fontSize: 12,
              color: 'var(--sub)',
              lineHeight: 1.65,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {previewText}
          </p>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--sub)', fontStyle: 'italic' }}>본문이 없습니다</p>
        )}

        {/* 이미지 */}
        {content.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.image_url}
            alt={`${label} 이미지`}
            style={{ width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--border)' }}
          />
        )}

        {/* 점수 상세 */}
        {content.scores && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: 10, background: 'var(--n50)', borderRadius: 7 }}>
            {([
              { key: 'seo', label: 'SEO' },
              { key: 'readability', label: '가독성' },
              { key: 'brand', label: '브랜드' },
              { key: 'legal', label: '법률' },
            ] as const).map((s) => (
              <div key={s.key} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 10, color: 'var(--sub)', margin: 0 }}>{s.label}</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '2px 0 0', fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
                  {content.scores![s.key]}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* 콘텐츠 상세 링크 */}
        <a
          href={`/content/manage`}
          style={{ fontSize: 11, color: 'var(--blue-600)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          콘텐츠 상세 보기 →
        </a>
      </div>
    </div>
  );
}
