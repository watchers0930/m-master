"use client";

import type { FormEvent } from "react";

import { EmptyStatePanel } from "@/components/ui/empty-state-panel";
import { InputField } from "@/components/ui/input-field";
import { StatusPill } from "@/components/ui/status-pill";
import { downloadImagesTar } from "@/features/dashboard/download-utils";
import type {
  BlogPublishDraft,
  BlogPublishPackage,
  ChannelKey,
  EditableBrandProfileField,
  ImageStudioState,
  ProjectActivityItem,
  ProjectDetail,
  ProjectListItem,
  ProjectPreview,
  SourceFileDraft,
  StudioDetail,
  WordPressPublishConfig,
  WordPressPublishResult,
} from "@/features/dashboard/types";

type CommercialWorkspaceProps = {
  name: string;
  domain: string;
  industry: string;
  workingPath: string;
  files: SourceFileDraft[];
  preview: ProjectPreview | null;
  folderSupported: boolean | null;
  error?: string | null;
  loading?: boolean;
  imageBusy?: boolean;
  exportBusy?: boolean;
  publishBusy?: boolean;
  settingsBusy?: boolean;
  copyStatus?: string | null;
  activeProject?: ProjectDetail | null;
  projects: ProjectListItem[];
  studio?: StudioDetail | null;
  blogImageStudio: ImageStudioState;
  history: ProjectActivityItem[];
  selectedTopicId?: string | null;
  publishPackage?: BlogPublishPackage | null;
  publishDraft: BlogPublishDraft;
  wordpressConfig: WordPressPublishConfig;
  wordpressResult?: WordPressPublishResult | null;
  onNameChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onPickFolder: () => Promise<void>;
  onPreview: () => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSelectProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onRegenerateContext: () => Promise<void>;
  onProjectIndustryChange: (value: string) => void;
  onSaveProjectSettings: () => Promise<void>;
  onBrandProfileChange: (field: EditableBrandProfileField, value: string) => void;
  onSaveContext: () => Promise<void>;
  onApproveContext: () => Promise<void>;
  onTopicSelect: (topicId: string) => void;
  onGenerateContent: () => Promise<void>;
  onSaveContent: () => Promise<void>;
  onAssetChange: (channel: ChannelKey, field: "title" | "body" | "cta" | "hashtags", value: string) => void;
  onImagePromptChange: (value: string) => void;
  onGenerateImages: () => Promise<void>;
  onPreparePublish: () => Promise<void>;
  onSaveWordPressDefaults: () => Promise<void>;
  onPublishDraftChange: (field: keyof BlogPublishDraft, value: string) => void;
  onWordPressConfigChange: (field: keyof WordPressPublishConfig, value: string) => void;
  onDownloadBlogHtml: () => Promise<void>;
};

function WorkspaceIcon({ kind }: { kind: "brief" | "content" | "image" | "publish" }) {
  const pathMap = {
    brief: "M4 8h16M4 12h10M4 16h8M14 5h6v6h-6z",
    content: "M5 5h14v14H5zM8 9h8M8 12h8M8 15h5",
    image: "M5 6h14v12H5zM8 14l3-3 2 2 3-4 2 5M9 9h.01",
    publish: "M12 3v10m0 0 4-4m-4 4-4-4M5 17v2h14v-2",
  } as const;

  return (
    <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={pathMap[kind]} />
    </svg>
  );
}

function analyzeBlogDraft(body?: string | null) {
  const text = (body || "").trim();
  const charCount = text.replace(/\s+/g, "").length;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !block.startsWith("[이미지 "));
  const headingCount = text.split("\n").filter((line) => line.trim().startsWith("## ")).length;
  const imageCueCount = text.split("\n").filter((line) => /^\[이미지\s+\d+\]/.test(line.trim())).length;

  return {
    charCount,
    paragraphCount: paragraphs.length,
    headingCount,
    imageCueCount,
    charOk: charCount >= 2200 && charCount <= 3200,
    paragraphOk: paragraphs.length >= 6 && paragraphs.length <= 10,
    imageOk: imageCueCount >= 5 && imageCueCount <= 8,
  };
}

function compact(value?: string | null, maxLength = 120) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

export function CommercialWorkspace(props: CommercialWorkspaceProps) {
  const {
    name,
    domain,
    industry,
    workingPath,
    files,
    preview,
    folderSupported,
    error,
    loading = false,
    imageBusy = false,
    exportBusy = false,
    publishBusy = false,
    settingsBusy = false,
    copyStatus = null,
    activeProject = null,
    projects,
    studio = null,
    blogImageStudio,
    history,
    selectedTopicId = null,
    publishPackage = null,
    publishDraft,
    wordpressConfig,
    wordpressResult = null,
    onNameChange,
    onDomainChange,
    onIndustryChange,
    onPickFolder,
    onPreview,
    onSubmit,
    onSelectProject,
    onDeleteProject,
    onRegenerateContext,
    onProjectIndustryChange,
    onSaveProjectSettings,
    onBrandProfileChange,
    onSaveContext,
    onApproveContext,
    onTopicSelect,
    onGenerateContent,
    onSaveContent,
    onAssetChange,
    onImagePromptChange,
    onGenerateImages,
    onPreparePublish,
    onSaveWordPressDefaults,
    onPublishDraftChange,
    onWordPressConfigChange,
    onDownloadBlogHtml,
  } = props;

  const contextApproved = Boolean(activeProject?.brandProfile?.approved);
  const blogAsset = studio?.draft.assets.find((asset) => asset.channel === "blog");
  const instagramAsset = studio?.draft.assets.find((asset) => asset.channel === "instagram");
  const facebookAsset = studio?.draft.assets.find((asset) => asset.channel === "facebook");
  const blogImageGroup = studio?.draft.images.find((group) => group.channel === "blog");
  const coverImage =
    blogImageGroup?.variants.find((variant) => variant.role === "cover" || variant.selected)?.url ||
    blogImageGroup?.variants[0]?.url ||
    null;
  const bodyImages =
    blogImageGroup?.variants
      .filter((variant) => variant.role.startsWith("body-"))
      .sort((left, right) => left.role.localeCompare(right.role, "en")) || [];
  const blogMetrics = analyzeBlogDraft(blogAsset?.body);

  async function handleDownloadImageBundle() {
    if (!activeProject?.project.id || !blogImageGroup?.variants.length) {
      return;
    }

    await downloadImagesTar({
      archiveName: `${activeProject.project.name}-blog-images`,
      images: blogImageGroup.variants.map((variant, index) => ({
        filename: `${variant.role || `image-${index + 1}`}.${variant.url.startsWith("data:image/png") ? "png" : variant.url.startsWith("data:image/webp") ? "webp" : variant.url.startsWith("data:image/svg+xml") ? "svg" : "png"}`,
        url: variant.url,
      })),
    });
  }

  return (
    <div className="commercial-shell">
      <aside className="commercial-column">
        <section className="commercial-card commercial-card-hero">
          <div className="commercial-card-heading">
            <WorkspaceIcon kind="brief" />
            <div>
              <p className="commercial-kicker">Brand Intake</p>
              <h2>프로젝트 입력과 콘셉트</h2>
            </div>
          </div>
          <p className="commercial-copy">
            제목, 서비스 콘셉트, 사이트 주소, 자료 업로드를 한쪽에서 정리하고 바로 블로그 제작으로 연결합니다.
          </p>
        </section>

        {!activeProject ? (
          <section className="commercial-card">
            <form className="commercial-form" onSubmit={onSubmit}>
              <InputField id="commercial-project-name" label="제목" value={name} onChange={onNameChange} placeholder="프로젝트 또는 캠페인 제목" />
              <InputField id="commercial-project-domain" label="사이트 주소" value={domain} onChange={onDomainChange} placeholder="https://example.com" />
              <div className="field-group">
                <label className="field-label" htmlFor="commercial-industry">
                  업종
                </label>
                <select id="commercial-industry" className="text-input" value={industry} onChange={(event) => onIndustryChange(event.target.value)}>
                  <option value="general">일반</option>
                  <option value="real-estate">부동산</option>
                  <option value="marketing">마케팅</option>
                  <option value="saas">SaaS</option>
                  <option value="finance">금융</option>
                </select>
              </div>
              <div className="workspace-upload-card">
                <div>
                  <strong>자료 업로드</strong>
                  <p className="fine-print">
                    소개서, 브로슈어, 기획안, FAQ를 연결하면 콘셉트와 해시태그 추천이 더 정확해집니다.
                  </p>
                </div>
                <button className="button ghost" type="button" onClick={() => void onPickFolder()}>
                  파일 연결
                </button>
                <p className="fine-print">
                  {folderSupported === false
                    ? "현재 브라우저는 폴더 선택 API를 지원하지 않습니다."
                    : workingPath || "아직 연결된 자료가 없습니다."}
                </p>
                {files.length ? (
                  <div className="workspace-chip-row">
                    {files.slice(0, 6).map((file) => (
                      <span className="workspace-chip" key={`${file.relativePath || file.name}-${file.size ?? 0}`}>
                        {file.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {error ? <p className="error-text">{error}</p> : null}
              <div className="button-row">
                <button className="button" disabled={loading} type="button" onClick={() => void onPreview()}>
                  {loading ? "분석 중" : "미리 보기"}
                </button>
                <button className="button primary" disabled={loading} type="submit">
                  {loading ? "생성 중" : "콘텐츠 생성하기"}
                </button>
              </div>
            </form>
            {preview ? (
              <div className="workspace-note">
                <strong>자동 추출 요약</strong>
                <p className="fine-print">{compact(preview.brandProfile.summary, 220)}</p>
                <p className="fine-print">추천 테마: {preview.topics.slice(0, 3).map((topic) => topic.title).join(", ") || "없음"}</p>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <section className="commercial-card">
              <div className="commercial-inline-header">
                <div>
                  <strong>{activeProject.project.name}</strong>
                  <p className="fine-print">{activeProject.project.domain || "사이트 주소 없음"}</p>
                </div>
                <StatusPill active={contextApproved}>{contextApproved ? "승인됨" : "검토 필요"}</StatusPill>
              </div>
              <div className="workspace-meta-grid">
                <div>
                  <span className="workspace-meta-label">업종</span>
                  <select
                    className="text-input"
                    value={activeProject.project.industry || "general"}
                    onChange={(event) => onProjectIndustryChange(event.target.value)}
                  >
                    <option value="general">일반</option>
                    <option value="real-estate">부동산</option>
                    <option value="marketing">마케팅</option>
                    <option value="saas">SaaS</option>
                    <option value="finance">금융</option>
                  </select>
                </div>
                <div>
                  <span className="workspace-meta-label">연결 자료</span>
                  <div className="workspace-muted-box">{activeProject.project.workingPath || "연결된 자료 없음"}</div>
                </div>
              </div>
              <div className="button-row">
                <button className="button ghost" disabled={loading} type="button" onClick={() => void onSaveProjectSettings()}>
                  {loading ? "저장 중" : "프로젝트 저장"}
                </button>
                <button className="button ghost" disabled={loading} type="button" onClick={() => void onRegenerateContext()}>
                  {loading ? "재생성 중" : "사이트 다시 읽기"}
                </button>
              </div>
            </section>

            {activeProject.brandProfile ? (
              <section className="commercial-card">
                <div className="commercial-card-heading">
                  <WorkspaceIcon kind="content" />
                  <div>
                    <p className="commercial-kicker">Concept</p>
                    <h3>브랜드 콘셉트</h3>
                  </div>
                </div>
                <InputField
                  id="workspace-brand-summary"
                  label="컨셉"
                  value={activeProject.brandProfile.summary}
                  onChange={(value) => onBrandProfileChange("summary", value)}
                  placeholder="브랜드와 서비스 콘셉트를 정리하세요."
                  multiline
                  rows={7}
                />
                <div className="workspace-two-up">
                  <InputField
                    id="workspace-brand-audience"
                    label="타겟"
                    value={activeProject.brandProfile.audience || ""}
                    onChange={(value) => onBrandProfileChange("audience", value)}
                    placeholder="주요 독자"
                    multiline
                    rows={4}
                  />
                  <InputField
                    id="workspace-brand-cta"
                    label="CTA"
                    value={activeProject.brandProfile.cta || ""}
                    onChange={(value) => onBrandProfileChange("cta", value)}
                    placeholder="문의, 신청, 상담"
                    multiline
                    rows={4}
                  />
                </div>
                <div className="button-row">
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onSaveContext()}>
                    {loading ? "저장 중" : "콘셉트 저장"}
                  </button>
                  <button className="button primary" disabled={loading} type="button" onClick={() => void onApproveContext()}>
                    {loading ? "진행 중" : contextApproved ? "승인 상태 유지" : "이 콘셉트로 진행"}
                  </button>
                </div>
              </section>
            ) : null}

            <section className="commercial-card">
              <div className="commercial-inline-header">
                <div>
                  <strong>프로젝트 전환</strong>
                  <p className="fine-print">현재 저장된 프로젝트를 바로 바꿔가며 작업할 수 있습니다.</p>
                </div>
              </div>
              <div className="workspace-project-list">
                {projects.map((project) => (
                  <div className={`workspace-project-row ${activeProject.project.id === project.id ? "active" : ""}`} key={project.id}>
                    <button className="workspace-project-button" type="button" onClick={() => void onSelectProject(project.id)}>
                      <strong>{project.name}</strong>
                      <span className="fine-print">{project.domain || "사이트 주소 없음"}</span>
                    </button>
                    <button className="button ghost danger" type="button" onClick={() => onDeleteProject(project.id)}>
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {contextApproved && activeProject.topics.length ? (
              <section className="commercial-card">
                <div className="commercial-inline-header">
                  <div>
                    <strong>해시태그와 테마</strong>
                    <p className="fine-print">블로그를 먼저 만들고, 인스타그램과 페이스북은 블로그 초안을 기준으로 자동 생성합니다.</p>
                  </div>
                </div>
                <div className="workspace-chip-grid">
                  {activeProject.topics.map((topic) => (
                    <button
                      className={`workspace-topic-card ${selectedTopicId === topic.id ? "active" : ""}`}
                      key={topic.id}
                      type="button"
                      onClick={() => onTopicSelect(topic.id)}
                    >
                      <strong>{topic.title}</strong>
                      <span className="fine-print">{compact(topic.rationale, 88) || topic.intentType || "추천 테마"}</span>
                    </button>
                  ))}
                </div>
                <div className="button-row">
                  <button className="button primary" disabled={loading || !selectedTopicId} type="button" onClick={() => void onGenerateContent()}>
                    {loading ? "생성 중" : "블로그 기준 콘텐츠 생성"}
                  </button>
                </div>
                {blogAsset?.hashtags ? (
                  <div className="workspace-chip-row">
                    {blogAsset.hashtags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                      <span className="workspace-chip" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </aside>

      <section className="commercial-column">
        <section className="commercial-card commercial-preview-card">
          <div className="commercial-card-heading">
            <WorkspaceIcon kind="content" />
            <div>
              <p className="commercial-kicker">Blog Source</p>
              <h2>블로그 본문</h2>
            </div>
          </div>
          {blogAsset ? (
            <>
              <div className="commercial-cover-preview">
                {coverImage ? <img alt={blogAsset.title} src={coverImage} /> : <div className="workspace-cover-empty">썸네일 생성 전</div>}
              </div>
              <InputField
                id="workspace-blog-title"
                label="블로그 제목"
                value={blogAsset.title}
                onChange={(value) => onAssetChange("blog", "title", value)}
                placeholder="네이버 블로그 제목"
              />
              <InputField
                id="workspace-blog-body"
                label="블로그 본문"
                value={blogAsset.body}
                onChange={(value) => onAssetChange("blog", "body", value)}
                placeholder="네이버 블로그 본문"
                multiline
                rows={18}
              />
              <div className="workspace-two-up">
                <InputField
                  id="workspace-blog-cta"
                  label="블로그 CTA"
                  value={blogAsset.cta}
                  onChange={(value) => onAssetChange("blog", "cta", value)}
                  placeholder="상담, 문의, 신청"
                  multiline
                  rows={4}
                />
                <InputField
                  id="workspace-blog-tags"
                  label="블로그 해시태그"
                  value={blogAsset.hashtags}
                  onChange={(value) => onAssetChange("blog", "hashtags", value)}
                  placeholder="#브랜드, #키워드"
                  multiline
                  rows={4}
                />
              </div>
              <div className="workspace-metric-board">
                <div className={`workspace-metric-card ${blogMetrics.charOk ? "good" : "warn"}`}>
                  <span>글자수</span>
                  <strong>{blogMetrics.charCount}</strong>
                  <p className="fine-print">권장 2,200~3,200자</p>
                </div>
                <div className={`workspace-metric-card ${blogMetrics.paragraphOk ? "good" : "warn"}`}>
                  <span>문단수</span>
                  <strong>{blogMetrics.paragraphCount}</strong>
                  <p className="fine-print">권장 6~10문단</p>
                </div>
                <div className={`workspace-metric-card ${blogMetrics.imageOk ? "good" : "warn"}`}>
                  <span>이미지 큐</span>
                  <strong>{blogMetrics.imageCueCount}</strong>
                  <p className="fine-print">권장 5~8장</p>
                </div>
                <div className={`workspace-metric-card ${blogMetrics.headingCount >= 5 ? "good" : "warn"}`}>
                  <span>섹션</span>
                  <strong>{blogMetrics.headingCount}</strong>
                  <p className="fine-print">도입/본문/마무리 구조</p>
                </div>
              </div>
              <div className="button-row">
                <button className="button ghost" disabled={loading} type="button" onClick={() => void onGenerateContent()}>
                  {loading ? "재생성 중" : "블로그 다시 쓰기"}
                </button>
                <button className="button primary" disabled={loading} type="button" onClick={() => void onSaveContent()}>
                  {loading ? "저장 중" : "콘텐츠 저장"}
                </button>
              </div>
            </>
          ) : (
            <EmptyStatePanel
              title="아직 블로그 초안이 없습니다."
              description="왼쪽 열에서 프로젝트 콘셉트를 승인하고, 테마를 선택한 뒤 블로그 기준 콘텐츠 생성을 실행하세요."
            />
          )}
        </section>

        <section className="commercial-card">
          <div className="commercial-card-heading">
            <WorkspaceIcon kind="content" />
            <div>
              <p className="commercial-kicker">Derived Channels</p>
              <h3>인스타그램 · 페이스북 자동 파생</h3>
            </div>
          </div>
          <div className="workspace-social-stack">
            <article className="workspace-social-card">
              <div className="commercial-inline-header">
                <strong>인스타그램</strong>
                <StatusPill active>블로그 기반 자동 생성</StatusPill>
              </div>
              <InputField
                id="workspace-instagram-title"
                label="인스타그램 제목"
                value={instagramAsset?.title || ""}
                onChange={(value) => onAssetChange("instagram", "title", value)}
                placeholder="인스타그램 제목"
              />
              <InputField
                id="workspace-instagram-body"
                label="인스타그램 문안"
                value={instagramAsset?.body || ""}
                onChange={(value) => onAssetChange("instagram", "body", value)}
                placeholder="블로그 요약이 자동 반영됩니다."
                multiline
                rows={8}
              />
              <InputField
                id="workspace-instagram-cta"
                label="인스타그램 CTA"
                value={instagramAsset?.cta || ""}
                onChange={(value) => onAssetChange("instagram", "cta", value)}
                placeholder="인스타그램 CTA"
                multiline
                rows={3}
              />
              <InputField
                id="workspace-instagram-tags"
                label="인스타그램 해시태그"
                value={instagramAsset?.hashtags || ""}
                onChange={(value) => onAssetChange("instagram", "hashtags", value)}
                placeholder="#인스타그램, #태그"
                multiline
                rows={3}
              />
            </article>

            <article className="workspace-social-card">
              <div className="commercial-inline-header">
                <strong>페이스북</strong>
                <StatusPill active>블로그 기반 자동 생성</StatusPill>
              </div>
              <InputField
                id="workspace-facebook-title"
                label="페이스북 제목"
                value={facebookAsset?.title || ""}
                onChange={(value) => onAssetChange("facebook", "title", value)}
                placeholder="페이스북 제목"
              />
              <InputField
                id="workspace-facebook-body"
                label="페이스북 문안"
                value={facebookAsset?.body || ""}
                onChange={(value) => onAssetChange("facebook", "body", value)}
                placeholder="블로그 요약이 자동 반영됩니다."
                multiline
                rows={8}
              />
              <InputField
                id="workspace-facebook-cta"
                label="페이스북 CTA"
                value={facebookAsset?.cta || ""}
                onChange={(value) => onAssetChange("facebook", "cta", value)}
                placeholder="페이스북 CTA"
                multiline
                rows={3}
              />
              <InputField
                id="workspace-facebook-tags"
                label="페이스북 해시태그"
                value={facebookAsset?.hashtags || ""}
                onChange={(value) => onAssetChange("facebook", "hashtags", value)}
                placeholder="#페이스북, #태그"
                multiline
                rows={3}
              />
            </article>
          </div>
        </section>
      </section>

      <aside className="commercial-column">
        <section className="commercial-card">
          <div className="commercial-card-heading">
            <WorkspaceIcon kind="image" />
            <div>
              <p className="commercial-kicker">Image Rail</p>
              <h2>썸네일과 본문 이미지</h2>
            </div>
          </div>
          <InputField
            id="workspace-image-prompt"
            label="이미지 프롬프트"
            value={blogImageStudio.prompt}
            onChange={onImagePromptChange}
            placeholder="블로그 썸네일과 본문 이미지 콘셉트를 입력하세요."
            multiline
            rows={5}
          />
          <div className="button-row">
            <button className="button primary" disabled={imageBusy || !blogAsset} type="button" onClick={() => void onGenerateImages()}>
              {imageBusy ? "이미지 생성 중" : "썸네일/본문 이미지 생성"}
            </button>
          </div>
          <div className="workspace-image-stack">
            <div className="workspace-image-panel">
              <span className="workspace-panel-label">1행 · 썸네일</span>
              {coverImage ? <img alt="블로그 썸네일" src={coverImage} /> : <div className="workspace-image-empty">썸네일이 아직 없습니다.</div>}
            </div>
            <div className="workspace-image-grid">
              {bodyImages.length ? (
                bodyImages.map((image, index) => (
                  <figure className="workspace-image-panel body" key={image.id}>
                    <span className="workspace-panel-label">{`본문 ${index + 1}`}</span>
                    <img alt={`본문 이미지 ${index + 1}`} src={image.url} />
                  </figure>
                ))
              ) : (
                <div className="workspace-image-empty tall">2행부터 본문 이미지가 2열 그리드로 배치됩니다.</div>
              )}
            </div>
          </div>
        </section>

        <section className="commercial-card">
          <div className="commercial-card-heading">
            <WorkspaceIcon kind="publish" />
            <div>
              <p className="commercial-kicker">Output</p>
              <h3>HTML 및 발행</h3>
            </div>
          </div>
          <div className="button-row">
            <button className="button" disabled={exportBusy || !blogAsset} type="button" onClick={() => void onDownloadBlogHtml()}>
              {exportBusy ? "HTML 준비 중" : "블로그 HTML 다운로드"}
            </button>
            <button className="button ghost" disabled={!blogImageGroup?.variants.length} type="button" onClick={() => void handleDownloadImageBundle()}>
              이미지 묶음 다운로드
            </button>
          </div>
          {copyStatus ? <p className="fine-print">{copyStatus}</p> : null}
          <div className="workspace-provider-note">
            <strong>이미지 제작 제안</strong>
            <p className="fine-print">
              현재 앱은 OpenAI 이미지 경로를 쓰고 있습니다. 상업용 품질을 더 높일 때는 Ideogram, FLUX 계열(Replicate), Midjourney 같은 외부 생성 경로를 별도 연결하는 구성이 적합합니다.
            </p>
          </div>
          <div className="workspace-two-up">
            <InputField
              id="workspace-wordpress-site"
              label="워드프레스 주소"
              value={wordpressConfig.siteUrl}
              onChange={(value) => onWordPressConfigChange("siteUrl", value)}
              placeholder="https://yourblog.com"
            />
            <InputField
              id="workspace-wordpress-user"
              label="사용자명"
              value={wordpressConfig.username}
              onChange={(value) => onWordPressConfigChange("username", value)}
              placeholder="editor"
            />
          </div>
          <InputField
            id="workspace-wordpress-password"
            label="앱 비밀번호"
            value={wordpressConfig.appPassword}
            onChange={(value) => onWordPressConfigChange("appPassword", value)}
            type="password"
            placeholder="WordPress Application Password"
          />
          <div className="button-row">
            <button className="button ghost" disabled={settingsBusy} type="button" onClick={() => void onSaveWordPressDefaults()}>
              {settingsBusy ? "저장 중" : "워드프레스 기본값 저장"}
            </button>
            <button className="button primary" disabled={publishBusy || !blogAsset} type="button" onClick={() => void onPreparePublish()}>
              {publishBusy ? "발행 처리 중" : publishPackage ? "워드프레스 게시" : "블로그 발행 패키지 준비"}
            </button>
          </div>

          {publishPackage ? (
            <div className="workspace-publish-editor">
              <InputField
                id="workspace-publish-title"
                label="발행 제목"
                value={publishDraft.title}
                onChange={(value) => onPublishDraftChange("title", value)}
                placeholder="워드프레스 게시 제목"
              />
              <InputField
                id="workspace-publish-summary"
                label="발행 요약"
                value={publishDraft.summary}
                onChange={(value) => onPublishDraftChange("summary", value)}
                placeholder="발행 요약"
                multiline
                rows={4}
              />
              <InputField
                id="workspace-publish-html"
                label="발행 HTML"
                value={publishDraft.bodyHtml}
                onChange={(value) => onPublishDraftChange("bodyHtml", value)}
                placeholder="<article>...</article>"
                multiline
                rows={10}
              />
            </div>
          ) : null}

          {wordpressResult ? (
            <div className="workspace-note">
              <strong>게시 완료</strong>
              <p className="fine-print">{wordpressResult.link}</p>
            </div>
          ) : null}
        </section>

        <section className="commercial-card">
          <div className="commercial-inline-header">
            <strong>최근 작업</strong>
            <StatusPill>{`${history.length} entries`}</StatusPill>
          </div>
          <div className="workspace-history-list">
            {history.length ? (
              history.slice(0, 5).map((item) => (
                <article className="workspace-history-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <p className="fine-print">{item.description}</p>
                </article>
              ))
            ) : (
              <EmptyStatePanel title="최근 작업 이력이 없습니다." description="생성, 저장, 발행 작업이 누적되면 여기서 바로 확인할 수 있습니다." />
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
