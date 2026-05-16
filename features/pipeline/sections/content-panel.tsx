"use client";

import { SeoComplianceIndicator } from "../components/seo-compliance-indicator";
import { DerivedChannelPanel } from "../components/derived-channel-panel";
import { VariantComparisonCard } from "../components/variant-comparison";
import type {
  StudioDetail,
  SeoComplianceResult,
  ChannelKey,
  VariantGroup,
  ExportPreviewState,
} from "../types";

type Props = {
  projectId?: string | null;
  contextReady: boolean;
  studio: StudioDetail | null;
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

  if (!hasAssets) {
    return (
      <div className="content-panel">
        <div className="cp-empty">
          <span className="eyebrow">콘텐츠 미리보기</span>
          <p className="fine-print">좌측에서 프로젝트를 등록하고 콘텐츠를 생성하면 여기에 표시됩니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="content-panel">
      {/* Channel tabs */}
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

      {/* Blog editor */}
      {activeChannel === "blog" ? (
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
      ) : (
        <DerivedChannelPanel assets={studio?.draft?.assets ?? []} />
      )}

      {/* A/B Variant comparison */}
      {hasVariants && (
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
      {exportPreview.bundle && (
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
