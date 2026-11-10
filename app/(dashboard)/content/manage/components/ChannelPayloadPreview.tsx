// 채널 발행 페이로드 미리보기 (표시 전용) — 서버 publish_preview 를 그대로 렌더한다.
// 이미지 선택·캡션 변환은 서버가 발행기와 같은 규칙으로 계산(lib/content/publish-payload.ts) — 여기서 재계산 금지.
import type { PublishPreviewDTO } from '@/types/content-review';
import { renderBodyWithImages } from './BodyMarkdown';

const LABEL = { fontSize: 11, fontWeight: 600, color: 'var(--sub)', margin: '0 0 6px' } as const;
const BOX = { padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--n50)', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7, wordBreak: 'break-word' } as const;

function ModeNote({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  const error = tone === 'error';
  return (
    <p role={error ? 'alert' : undefined} style={{
      fontSize: 11.5, margin: 0, padding: '8px 10px', borderRadius: 6, lineHeight: 1.5,
      background: error ? '#fee2e2' : 'var(--blue-100)', color: error ? '#b91c1c' : 'var(--blue-700)',
    }}>{text}</p>
  );
}

function ImageStrip({ images, square }: { images: string[]; square?: boolean }) {
  if (images.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: images.length > 1 ? 'repeat(auto-fill, minmax(120px, 1fr))' : '1fr', gap: 10 }}>
      {images.map((url, i) => (
        <figure key={`${i}-${url}`} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <img src={url} alt={`발행 이미지 ${i + 1}`} style={{
            width: '100%', aspectRatio: square ? '1 / 1' : undefined, maxHeight: square ? undefined : 280,
            objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block',
          }} />
          {images.length > 1 && <figcaption style={{ fontSize: 12, color: 'var(--sub)', textAlign: 'center' }}>{i + 1} / {images.length}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function PlainText({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p style={LABEL}>{label}</p>
      <div style={{ ...BOX, whiteSpace: 'pre-wrap' }}>{text || <span style={{ color: 'var(--sub)' }}>내용이 없습니다</span>}</div>
    </div>
  );
}

export default function ChannelPayloadPreview({ preview }: { preview: Exclude<PublishPreviewDTO, { channel: 'blog' }> }) {
  if (preview.channel === 'instagram') {
    return (
      <>
        {preview.mode === 'blocked'
          ? <ModeNote tone="error" text={`발행할 수 없습니다 — ${preview.blocked_reason ?? '발행 이미지가 필요합니다.'}`} />
          : <ModeNote text={preview.mode === 'carousel' ? `캐러셀 ${preview.images.length}장으로 발행됩니다` : '단일 이미지로 발행됩니다'} />}
        <ImageStrip images={preview.images} square />
        <PlainText label="캡션 (발행 문구 그대로)" text={preview.text} />
      </>
    );
  }
  if (preview.channel === 'facebook') {
    return (
      <>
        <ModeNote text={preview.mode === 'photo' ? '사진 1장 + 메시지로 발행됩니다' : '이미지 없이 텍스트로 발행됩니다'} />
        <ImageStrip images={preview.images} />
        <PlainText label="메시지 (발행 문구 그대로)" text={preview.text} />
      </>
    );
  }
  return (
    <>
      <ModeNote text={preview.images.length > 0
        ? '대표 이미지 1장이 첨부되어 본문 상단에 배치됩니다 (본문 이미지 마커는 제외)'
        : '이미지 없이 발행됩니다 (본문 이미지 마커는 제외)'} />
      <div>
        <p style={LABEL}>제목</p>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{preview.subject}</p>
      </div>
      <ImageStrip images={preview.images} />
      <div>
        <p style={LABEL}>본문</p>
        <div style={BOX}>{preview.text ? renderBodyWithImages(preview.text, [], true) : <span style={{ color: 'var(--sub)' }}>본문이 없습니다</span>}</div>
        {preview.footer_appended && <p style={{ fontSize: 12, color: 'var(--sub)', margin: '6px 0 0' }}>본문 하단에 서비스 안내 푸터가 자동으로 추가됩니다.</p>}
      </div>
    </>
  );
}
