// 콘텐츠 본문 미리보기 — 점수·키워드·대표 이미지·본문 (기존 ContentDetailPanel 에서 이전, 표시 전용).
// 본문은 저장된 text_body 그대로 렌더한다. 전략 근거 수치는 여기 주입하지 않는다(설계 §6).
// 블로그 외 채널은 서버 publish_preview(발행기와 같은 규칙·변환)를 그대로 보여준다 — ChannelPayloadPreview.
import type { ContentDetail } from '@/types/content-review';
import ChannelPayloadPreview from './ChannelPayloadPreview';
import { renderBodyWithImages } from './BodyMarkdown';

const SCORE_KEYS = [
  { key: 'seo', label: 'SEO' },
  { key: 'readability', label: '가독성' },
  { key: 'brand', label: '브랜드' },
  { key: 'legal', label: '법률' },
] as const;

export default function ContentBodyPreview({ data }: { data: ContentDetail }) {
  const preview = data.publish_preview;
  const isBlog = !preview || preview.channel === 'blog';
  return (
    <>
      {/* 점수 상세 */}
      {data.scores && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 12, background: 'var(--n50)', borderRadius: 8 }}>
          {SCORE_KEYS.map((s) => (
            <div key={s.key} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: 'var(--sub)', margin: 0 }}>{s.label}</p>
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

      {/* 블로그 외 채널: 실제 발행 페이로드 */}
      {preview && preview.channel !== 'blog' && <ChannelPayloadPreview preview={preview} />}

      {/* 이미지 (블로그) */}
      {isBlog && data.image_url && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>이미지</p>
          <img src={data.image_url} alt={data.topic} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
      )}

      {/* 본문 (블로그) */}
      {isBlog && <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>본문</p>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--n50)', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7, wordBreak: 'break-word' }}>
          {data.text_body
            ? renderBodyWithImages(data.text_body, data.body_image_urls ?? [])
            : <span style={{ color: 'var(--sub)' }}>본문이 없습니다</span>}
        </div>
      </div>}
    </>
  );
}
