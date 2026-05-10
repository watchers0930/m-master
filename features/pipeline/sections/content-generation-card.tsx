"use client";

import { SectionCard } from "@/components/ui/section-card";
import { SectionLockOverlay } from "../components/section-lock-overlay";
import { SeoComplianceIndicator } from "../components/seo-compliance-indicator";
import { DerivedChannelPanel } from "../components/derived-channel-panel";
import type { StudioDetail, SeoComplianceResult, ChannelKey } from "../types";

type Props = {
  locked: boolean;
  studio: StudioDetail | null;
  // Topic selection
  topics: Array<{ id: string; title: string; score?: number | null }>;
  selectedTopicId: string | null;
  onSelectTopic: (id: string) => void;
  // Generation
  generateBusy: boolean;
  onGenerate: () => void;
  // SEO
  seoCompliance: SeoComplianceResult | null;
  // Blog editing
  activeChannel: ChannelKey;
  onChannelChange: (ch: ChannelKey) => void;
  editingTitle: string;
  onEditingTitleChange: (v: string) => void;
  editingBody: string;
  onEditingBodyChange: (v: string) => void;
  editingCta: string;
  onEditingCtaChange: (v: string) => void;
  editingHashtags: string;
  onEditingHashtagsChange: (v: string) => void;
  onUpdateSeo: () => void;
  // Save
  saveBusy: boolean;
  onSave: () => void;
};

export function ContentGenerationCard(props: Props) {
  const {
    locked, studio, topics,
    selectedTopicId, onSelectTopic,
    generateBusy, onGenerate,
    seoCompliance,
    activeChannel, onChannelChange,
    editingTitle, onEditingTitleChange,
    editingBody, onEditingBodyChange,
    editingCta, onEditingCtaChange,
    editingHashtags, onEditingHashtagsChange,
    onUpdateSeo,
    saveBusy, onSave,
  } = props;

  const hasAssets = (studio?.draft?.assets?.length ?? 0) > 0;
  const blogAsset = studio?.draft?.assets?.find((a) => a.channel === "blog");

  return (
    <div className="pipeline-section">
      <SectionCard title="콘텐츠 생성" description="블로그 원본 → 인스타/페북 자동 파생">
        {locked && <SectionLockOverlay message="브랜드 콘텍스트를 먼저 승인해 주세요." />}

        <div className="wizard-stage">
          {/* Topic selection */}
          {topics.length > 0 && (
            <div className="stack">
              <p className="field-label">토픽 선택</p>
              <div className="topic-chip-wrap">
                {topics.map((topic) => (
                  <button
                    key={topic.id}
                    className={`topic-chip selectable ${selectedTopicId === topic.id ? "active" : ""}`}
                    onClick={() => onSelectTopic(topic.id)}
                  >
                    <strong>{topic.title}</strong>
                    {topic.score != null && (
                      <span className="fine-print">점수 {topic.score}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Generate button */}
          <div className="button-row">
            <button
              className="button primary"
              disabled={generateBusy}
              onClick={onGenerate}
            >
              {generateBusy ? "전체 생성 중…" : "전체 생성"}
            </button>
          </div>

          {/* Channel tabs + Editor */}
          {hasAssets && (
            <>
              <div className="content-tabs">
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

              {activeChannel === "blog" ? (
                <div className="content-editor-grid">
                  {/* SEO indicator */}
                  {seoCompliance && <SeoComplianceIndicator result={seoCompliance} />}

                  {/* Blog editor */}
                  <div className="form-grid">
                    <div className="field-group">
                      <label className="field-label">제목 (60자 권장)</label>
                      <input
                        className="text-input"
                        value={editingTitle}
                        onChange={(e) => { onEditingTitleChange(e.target.value); }}
                        onBlur={onUpdateSeo}
                        maxLength={120}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">본문</label>
                      <textarea
                        className="text-area"
                        value={editingBody}
                        onChange={(e) => { onEditingBodyChange(e.target.value); }}
                        onBlur={onUpdateSeo}
                        rows={16}
                        style={{ minHeight: 400 }}
                      />
                    </div>
                    <div className="field-grid-2">
                      <div className="field-group">
                        <label className="field-label">CTA</label>
                        <input
                          className="text-input"
                          value={editingCta}
                          onChange={(e) => onEditingCtaChange(e.target.value)}
                        />
                      </div>
                      <div className="field-group">
                        <label className="field-label">해시태그</label>
                        <input
                          className="text-input"
                          value={editingHashtags}
                          onChange={(e) => { onEditingHashtagsChange(e.target.value); }}
                          onBlur={onUpdateSeo}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="button-row">
                    <button className="button primary" disabled={saveBusy} onClick={onSave}>
                      {saveBusy ? "저장 중…" : "저장"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Derived channels — read-only */
                <DerivedChannelPanel assets={studio?.draft?.assets ?? []} />
              )}
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
