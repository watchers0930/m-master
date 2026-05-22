// lib/imagen/instagram-card.tsx — 인스타그램 카드뉴스 이미지 생성기
// next/og의 ImageResponse로 1080x1080 PNG 생성

import { ImageResponse } from 'next/og';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CardData {
  title: string;
  body: string;
  footnote?: string;
  cardIndex: number;
  totalCards: number;
}

// ---------------------------------------------------------------------------
// Pretendard 폰트 캐시 (서버 프로세스 내 1회만 로드)
// ---------------------------------------------------------------------------
let fontCache: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache;
  const res = await fetch(
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-Bold.woff2',
  );
  fontCache = await res.arrayBuffer();
  return fontCache;
}

// ---------------------------------------------------------------------------
// 브랜드 색상
// ---------------------------------------------------------------------------
const BRAND = {
  bg: '#1a1a2e',
  accent: '#4361ee',
  text: '#ffffff',
  sub: '#a0a4b8',
  indicator: '#3a3a5c',
  indicatorActive: '#4361ee',
} as const;

// ---------------------------------------------------------------------------
// 카드 이미지 생성
// ---------------------------------------------------------------------------
export async function generateInstagramCard(card: CardData): Promise<Buffer> {
  const fontData = await loadFont();

  const indicators = Array.from({ length: card.totalCards }, (_, i) => (
    <div
      key={i}
      style={{
        width: i === card.cardIndex ? 24 : 8,
        height: 8,
        borderRadius: 4,
        background: i === card.cardIndex ? BRAND.indicatorActive : BRAND.indicator,
      }}
    />
  ));

  const response = new ImageResponse(
    (
      <div
        style={{
          width: 1080,
          height: 1080,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BRAND.bg,
          padding: '80px 72px 60px',
          fontFamily: 'Pretendard',
        }}
      >
        {/* 상단: 로고 + 카드 번호 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: BRAND.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              V
            </div>
            <span style={{ fontSize: 28, fontWeight: 700, color: BRAND.sub }}>VESTRA</span>
          </div>
          <span style={{ fontSize: 24, color: BRAND.sub }}>
            {card.cardIndex + 1} / {card.totalCards}
          </span>
        </div>

        {/* 중앙: 제목 + 본문 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32, flex: 1, justifyContent: 'center' }}>
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              color: BRAND.text,
              lineHeight: 1.3,
              wordBreak: 'keep-all',
            }}
          >
            {card.title}
          </div>
          <div
            style={{
              fontSize: 36,
              color: BRAND.sub,
              lineHeight: 1.6,
              wordBreak: 'keep-all',
            }}
          >
            {card.body}
          </div>
          {card.footnote && (
            <div
              style={{
                fontSize: 26,
                color: BRAND.indicator,
                lineHeight: 1.5,
                borderLeft: `4px solid ${BRAND.accent}`,
                paddingLeft: 20,
              }}
            >
              {card.footnote}
            </div>
          )}
        </div>

        {/* 하단: 페이지 인디케이터 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {indicators}
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: [
        {
          name: 'Pretendard',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
    },
  );

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
