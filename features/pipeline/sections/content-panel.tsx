"use client";

import type { ReactNode } from "react";
import { SeoComplianceIndicator } from "../components/seo-compliance-indicator";
import { DerivedChannelPanel } from "../components/derived-channel-panel";
import { VariantComparisonCard } from "../components/variant-comparison";
import type {
  StudioDetail,
  SeoComplianceResult,
  ChannelKey,
  VariantGroup,
  ExportPreviewState,
  ImageStudioState,
} from "../types";

function renderBlogPreview(body: string, imageStudio: ImageStudioState | null): ReactNode[] {
  const imageUrls = (imageStudio?.variants || [])
    .slice()
    .sort((left, right) => {
      if (left.selected && !right.selected) return -1;
      if (!left.selected && right.selected) return 1;
      return left.id.localeCompare(right.id);
    })
    .map((variant) => variant.url)
    .filter(Boolean);
  const blocks: ReactNode[] = [];
  const lines = body.split("\n");
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (!paragraphBuffer.length) {
      return;
    }

    const text = paragraphBuffer.join(" ").trim();
    if (text) {
      blocks.push(
        <p key={`paragraph-${blocks.length}`} className="fine-print" style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, fontSize: 16, color: "#111827" }}>
          {text}
        </p>,
      );
    }
    paragraphBuffer = [];
  }

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      return;
    }

    const imageCue = line.match(/^\[이미지\s+(\d+)\]\s*(.*)$/);
    if (imageCue) {
      flushParagraph();
      const imageIndex = Math.max(0, Number(imageCue[1]) - 1);
      const imageUrl = imageUrls.length > 0 ? imageUrls[imageIndex % imageUrls.length] : null;
      const caption = imageCue[2] || `이미지 ${imageCue[1]}`;
      blocks.push(
        <figure key={`image-${index}`} style={{ margin: "16px 0 24px" }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={caption}
              style={{ width: "100%", borderRadius: 18, border: "1px solid #dbe4f0", display: "block" }}
            />
          ) : (
            <div style={{ border: "1px dashed #cbd5e1", borderRadius: 18, padding: "28px 18px", textAlign: "center", color: "#64748b" }}>
              선택된 이미지가 아직 없습니다.
            </div>
          )}
          <figcaption className="fine-print" style={{ marginTop: 10 }}>
            {caption}
          </figcaption>
        </figure>,
      );
      return;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push(
        <h3 key={`h2-${index}`} style={{ margin: "28px 0 12px", fontSize: 28, lineHeight: 1.25, fontWeight: 800, color: "#111827" }}>
          {line.replace(/^##\s*/, "")}
        </h3>,
      );
      return;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push(
        <h4 key={`h3-${index}`} style={{ margin: "24px 0 10px", fontSize: 22, lineHeight: 1.35, fontWeight: 700, color: "#1f2937" }}>
          {line.replace(/^###\s*/, "")}
        </h4>,
      );
      return;
    }

    paragraphBuffer.push(line);
  });

  flushParagraph();
  return blocks;
}

type Props = {
  projectId?: string | null;
  contextReady: boolean;
  studio: StudioDetail | null;
  blogImageStudio: ImageStudioState | null;
  topicInput: string;
  onTopicInputChange: (value: string) => void;
  generateBusy: boolean;
  onGenerate: () => void;
  /* Channel */
  activeChannel: ChannelKey;
  onChannelChange: (ch: ChannelKey) => void;
  /* Blog editor */
  editingTitle: string;
  onEditingTitleChange: (v: string) => void;
  editingBody: string;
  onEditingBodyChange: (v: string) => void;
  editingCta: string;
  onEditingCtaChange: (v: string) => void;
  editingHashtags: string;
  onEditingHashtagsChange: (v: string) => void;
  onUpdateSeo: () => void;
  /* SEO */
  seoCompliance: SeoComplianceResult | null;
  /* Save */
  saveBusy: boolean;
  onSave: () => void;
  /* Variants */
  variantGroup: VariantGroup | null;
  adoptBusy: string | null;
  onAdoptVariant: (id: string) => void;
  /* Export preview */
  exportPreview: ExportPreviewState;
  onExportChannel: (ch: ChannelKey) => void;
  onExportPreviewViewChange: (view: ChannelKey | "json") => void;
  onCopyExportPreview: () => void;
  copyBusy: boolean;
  copyStatus: string | null;
};

export function ContentPanel(props: Props) {
  const {
    projectId,
    contextReady,
    studio,
    blogImageStudio,
    topicInput,
    onTopicInputChange,
    generateBusy,
    onGenerate,
    activeChannel, onChannelChange,
    editingTitle, onEditingTitleChange,
    editingBody, onEditingBodyChange,
    editingCta, onEditingCtaChange,
    editingHashtags, onEditingHashtagsChange,
    onUpdateSeo,
    seoCompliance,
    saveBusy, onSave,
    variantGroup, adoptBusy, onAdoptVariant,
    exportPreview, onExportChannel, onExportPreviewViewChange,
    onCopyExportPreview, copyBusy, copyStatus,
  } = props;

  const hasAssets = (studio?.draft?.assets?.length ?? 0) > 0;
  const hasVariants = (variantGroup?.variants?.length ?? 0) > 0;

  if (!contextReady) {
    return (
      <div className="content-panel">
        <div className="cp-empty">
          <span className="eyebrow">콘텐츠 생성</span>
          <p className="fine-print">콘텐츠 생성 전 준비는 설정 화면에서 끝냅니다. 브랜드 컨텍스트를 저장하고 승인한 뒤 다시 돌아오세요.</p>
          <div className="button-row" style={{ marginTop: 16 }}>
            <a className="button primary" href={projectId ? `/studio/settings?projectId=${projectId}` : "/studio/settings"}>
              설정으로 이동
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-panel">
      <div className="stack" style={{ marginBottom: 20 }}>
        <div className="cp-empty">
          <span className="eyebrow">콘텐츠 생성</span>
          <p className="fine-print">주제 입력폼은 계속 유지되고, 생성 결과만 아래에 이어집니다.</p>
        </div>

        <div className="analytics-surface" style={{ padding: 24, borderRadius: 24 }}>
          <div className="stack">
            <div>
              <strong style={{ display: "block", fontSize: 20, marginBottom: 8 }}>직접 주제 입력</strong>
              <p className="fine-print">만들고 싶은 블로그 주제나 캠페인 테마를 바로 입력하면 블로그, 인스타그램, 페이스북 초안을 한 번에 생성합니다.</p>
            </div>
            <div className="field-group">
              <label className="field-label">콘텐츠 주제</label>
              <input
                className="text-input"
                value={topicInput}
                onChange={(e) => onTopicInputChange(e.target.value)}
                placeholder="예: 2026년 상반기 마케팅 자동화 체크리스트"
              />
            </div>
            <div className="button-row">
              <button className="button primary" type="button" disabled={generateBusy || !topicInput.trim()} onClick={onGenerate}>
                {generateBusy ? "초안 생성 중…" : "이 주제로 콘텐츠 만들기"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!hasAssets ? (
        <div className="cp-empty">
          <span className="eyebrow">생성 결과 대기</span>
          <p className="fine-print">위 입력폼에서 주제를 넣고 생성하면, 채널별 편집기와 미리보기가 아래에 이어서 열립니다.</p>
        </div>
      ) : null}

      {/* Channel tabs */}
      {hasAssets ? (
        <div className="cp-tabs">
        {(["blog", "instagram", "facebook"] as ChannelKey[]).map((ch) => (
          <button
            key={ch}
            className={`content-tab ${activeChannel === ch ? "active" : ""}`}
            onClick={() => onChannelChange(ch)}
          >
            {ch === "blog" ? "블로그" : ch === "instagram" ? "인스타" : "페이스북"}
          </button>
        ))}
        </div>
      ) : null}

      {/* Blog editor */}
      {hasAssets && activeChannel === "blog" ? (
        <div className="cp-editor">
          {seoCompliance && <SeoComplianceIndicator result={seoCompliance} />}

          <div className="field-group">
            <label className="field-label">제목 (60자 권장)</label>
            <input
              className="text-input"
              value={editingTitle}
              onChange={(e) => onEditingTitleChange(e.target.value)}
              onBlur={onUpdateSeo}
              maxLength={120}
            />
          </div>

          <div className="field-group">
            <label className="field-label">본문</label>
            <textarea
              className="text-area cp-body-editor"
              value={editingBody}
              onChange={(e) => onEditingBodyChange(e.target.value)}
              onBlur={onUpdateSeo}
              rows={20}
            />
          </div>
          <div className="field-group">
            <label className="field-label">본문 미리보기</label>
            <div className="analytics-surface" style={{ padding: 24, borderRadius: 20 }}>
              {renderBlogPreview(editingBody, blogImageStudio)}
            </div>
          </div>

          <div className="cp-meta-row">
            <div className="field-group">
              <label className="field-label">CTA</label>
              <input className="text-input" value={editingCta} onChange={(e) => onEditingCtaChange(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">해시태그</label>
              <input className="text-input" value={editingHashtags} onChange={(e) => onEditingHashtagsChange(e.target.value)} onBlur={onUpdateSeo} />
            </div>
          </div>

          <button className="button primary" disabled={saveBusy} onClick={onSave}>
            {saveBusy ? "저장 중…" : "저장"}
          </button>
        </div>
      ) : hasAssets ? (
        <DerivedChannelPanel assets={studio?.draft?.assets ?? []} />
      ) : null}

      {/* A/B Variant comparison */}
      {hasAssets && hasVariants && (
        <div className="cp-variants">
          <span className="eyebrow">A/B 버전 비교</span>
          <div className="variant-comparison-grid">
            {variantGroup!.variants.map((v) => (
              <VariantComparisonCard key={v.id} variant={v} onAdopt={onAdoptVariant} adoptBusy={adoptBusy === v.id} />
            ))}
          </div>
        </div>
      )}

      {/* Export preview */}
      {hasAssets && exportPreview.bundle && (
        <div className="cp-export">
          <div className="cp-tabs">
            {(["blog", "instagram", "facebook", "json"] as const).map((view) => (
              <button
                key={view}
                className={`content-tab ${exportPreview.activeView === view ? "active" : ""}`}
                onClick={() => onExportPreviewViewChange(view)}
              >
                {view === "json" ? "JSON" : view === "blog" ? "블로그" : view === "instagram" ? "인스타" : "페북"}
              </button>
            ))}
          </div>
          <div className="cp-export-body">
            {exportPreview.activeView === "json"
              ? JSON.stringify(exportPreview.bundle, null, 2)
              : exportPreview.bundle.channels.find((c) => c.channel === exportPreview.activeView)?.content || "(내용 없음)"}
          </div>
          <div className="cp-export-actions">
            <button className="button ghost" disabled={copyBusy} onClick={onCopyExportPreview}>
              {copyBusy ? "복사 중…" : "복사"}
            </button>
            {copyStatus && <span className="fine-print">{copyStatus}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
