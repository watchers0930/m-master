"use client";

import { useEffect, useState } from "react";

import type { CmsItemDto, CmsSectionDto } from "@/types/cms";

type ApiOk<T> = {
  ok: true;
  data: T;
};

type ApiError = {
  ok: false;
  error: {
    message: string;
  };
};

type ApiResponse<T> = ApiOk<T> | ApiError;

type ItemDraft = {
  slug: string;
  title: string;
  subtitle: string;
  clientName: string;
  periodLabel: string;
  summary: string;
  body: string;
  tags: string;
  imageUrl: string;
  linkUrl: string;
  status: string;
  featured: boolean;
  visible: boolean;
  sortOrder: number;
};

function toDraft(item?: CmsItemDto): ItemDraft {
  return {
    slug: item?.slug ?? "",
    title: item?.title ?? "",
    subtitle: item?.subtitle ?? "",
    clientName: item?.clientName ?? "",
    periodLabel: item?.periodLabel ?? "",
    summary: item?.summary ?? "",
    body: item?.body ?? "",
    tags: item?.tags.join(", ") ?? "",
    imageUrl: item?.imageUrl ?? "",
    linkUrl: item?.linkUrl ?? "",
    status: item?.status ?? "published",
    featured: item?.featured ?? false,
    visible: item?.visible ?? true,
    sortOrder: item?.sortOrder ?? 0,
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export function CmsAdminShell() {
  const [sections, setSections] = useState<CmsSectionDto[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(toDraft());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;
  const activeItem = activeSection?.items.find((item) => item.id === activeItemId) ?? null;

  useEffect(() => {
    void loadSections();
  }, []);

  useEffect(() => {
    if (!activeSection && sections[0]) {
      setActiveSectionId(sections[0].id);
      setActiveItemId(sections[0].items[0]?.id ?? null);
      setDraft(toDraft(sections[0].items[0]));
      return;
    }

    if (activeItem) {
      setDraft(toDraft(activeItem));
      return;
    }

    setDraft(toDraft());
  }, [activeItem, activeSection, sections]);

  async function loadSections() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/cms", { cache: "no-store" });
      const payload = await parseJson<ApiResponse<{ sections: CmsSectionDto[] }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setSections(payload.data.sections);
      setActiveSectionId((current) => current ?? payload.data.sections[0]?.id ?? null);
      setActiveItemId((current) => current ?? payload.data.sections[0]?.items[0]?.id ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "CMS를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function updateSection(section: CmsSectionDto, updates: Partial<CmsSectionDto>) {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/cms/sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: updates.title ?? section.title,
          description: updates.description ?? section.description,
          visible: updates.visible ?? section.visible,
          sortOrder: updates.sortOrder ?? section.sortOrder,
        }),
      });
      const payload = await parseJson<ApiResponse<{ sections: CmsSectionDto[] }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setSections(payload.data.sections);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "섹션을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem() {
    if (!activeSection) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const endpoint = activeItem ? `/api/cms/items/${activeItem.id}` : `/api/cms/sections/${activeSection.id}/items`;
      const method = activeItem ? "PATCH" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await parseJson<ApiResponse<{ sections: CmsSectionDto[] }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setSections(payload.data.sections);

      const refreshedSection = payload.data.sections.find((section) => section.id === activeSection.id);
      const nextItem = activeItem
        ? refreshedSection?.items.find((item) => item.id === activeItem.id) ?? refreshedSection?.items[0] ?? null
        : refreshedSection?.items.find((item) => item.slug === draft.slug) ?? refreshedSection?.items[0] ?? null;

      setActiveItemId(nextItem?.id ?? null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "항목을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem() {
    if (!activeItem || !activeSection) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/cms/items/${activeItem.id}`, {
        method: "DELETE",
      });
      const payload = await parseJson<ApiResponse<{ sections: CmsSectionDto[] }>>(response);

      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setSections(payload.data.sections);
      const refreshedSection = payload.data.sections.find((section) => section.id === activeSection.id);
      setActiveItemId(refreshedSection?.items[0]?.id ?? null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "항목을 삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="cms-admin-shell">
      <aside className="cms-admin-sidebar">
        <div className="cms-admin-brand">
          <p>CMS Admin</p>
          <h1>플랫폼개발 / 주요실적</h1>
          <a href="/">공개 페이지 보기</a>
        </div>
        {sections.map((section) => (
          <button
            className={section.id === activeSection?.id ? "cms-nav-item active" : "cms-nav-item"}
            key={section.id}
            onClick={() => {
              setActiveSectionId(section.id);
              setActiveItemId(section.items[0]?.id ?? null);
            }}
            type="button"
          >
            <strong>{section.title}</strong>
            <span>{section.items.length} items</span>
          </button>
        ))}
      </aside>

      <section className="cms-admin-main">
        <header className="cms-admin-header">
          <div>
            <p className="cms-section-kicker">관리 섹션</p>
            <h2>{activeSection?.title ?? "섹션 로딩 중"}</h2>
          </div>
          <div className="cms-header-actions">
            <a href="/studio">스튜디오 이동</a>
          </div>
        </header>

        {error ? <p className="cms-error-banner">{error}</p> : null}
        {loading ? <p className="cms-loading-copy">CMS 구성을 불러오는 중입니다.</p> : null}

        {activeSection ? (
          <div className="cms-admin-grid">
            <div className="cms-card">
              <div className="cms-card-head">
                <h3>섹션 설정</h3>
                <span>{activeSection.key}</span>
              </div>
              <label className="cms-field">
                <span>섹션 제목</span>
                <input
                  defaultValue={activeSection.title}
                  onBlur={(event) => void updateSection(activeSection, { title: event.target.value })}
                />
              </label>
              <label className="cms-field">
                <span>설명</span>
                <textarea
                  defaultValue={activeSection.description ?? ""}
                  onBlur={(event) => void updateSection(activeSection, { description: event.target.value })}
                  rows={4}
                />
              </label>
              <div className="cms-inline-fields">
                <label className="cms-field">
                  <span>정렬</span>
                  <input
                    defaultValue={activeSection.sortOrder}
                    min={0}
                    onBlur={(event) => void updateSection(activeSection, { sortOrder: Number(event.target.value) })}
                    type="number"
                  />
                </label>
                <label className="cms-toggle">
                  <input
                    checked={activeSection.visible}
                    onChange={(event) => void updateSection(activeSection, { visible: event.target.checked })}
                    type="checkbox"
                  />
                  <span>공개</span>
                </label>
              </div>
            </div>

            <div className="cms-card">
              <div className="cms-card-head">
                <h3>항목 목록</h3>
                <button
                  className="cms-secondary-button"
                  onClick={() => {
                    setActiveItemId(null);
                    setDraft(toDraft());
                  }}
                  type="button"
                >
                  새 항목
                </button>
              </div>
              <div className="cms-item-list">
                {activeSection.items.map((item) => (
                  <button
                    className={item.id === activeItemId ? "cms-item-row active" : "cms-item-row"}
                    key={item.id}
                    onClick={() => {
                      setActiveItemId(item.id);
                      setDraft(toDraft(item));
                    }}
                    type="button"
                  >
                    <strong>{item.title}</strong>
                    <span>{item.visible ? "공개" : "비공개"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="cms-card cms-editor-card">
              <div className="cms-card-head">
                <h3>{activeItem ? "항목 수정" : "항목 추가"}</h3>
                {activeItem ? <span>{activeItem.slug}</span> : null}
              </div>
              <div className="cms-form-grid">
                <label className="cms-field">
                  <span>제목</span>
                  <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>슬러그</span>
                  <input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>부제</span>
                  <input value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>고객사</span>
                  <input value={draft.clientName} onChange={(event) => setDraft({ ...draft, clientName: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>기간</span>
                  <input value={draft.periodLabel} onChange={(event) => setDraft({ ...draft, periodLabel: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>상태</span>
                  <input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} />
                </label>
                <label className="cms-field cms-field-wide">
                  <span>요약</span>
                  <textarea rows={4} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
                </label>
                <label className="cms-field cms-field-wide">
                  <span>상세 설명</span>
                  <textarea rows={6} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
                </label>
                <label className="cms-field cms-field-wide">
                  <span>태그</span>
                  <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>이미지 URL</span>
                  <input value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>링크 URL</span>
                  <input value={draft.linkUrl} onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })} />
                </label>
                <label className="cms-field">
                  <span>정렬</span>
                  <input
                    min={0}
                    type="number"
                    value={draft.sortOrder}
                    onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })}
                  />
                </label>
                <label className="cms-toggle">
                  <input
                    checked={draft.featured}
                    onChange={(event) => setDraft({ ...draft, featured: event.target.checked })}
                    type="checkbox"
                  />
                  <span>대표 노출</span>
                </label>
                <label className="cms-toggle">
                  <input
                    checked={draft.visible}
                    onChange={(event) => setDraft({ ...draft, visible: event.target.checked })}
                    type="checkbox"
                  />
                  <span>공개</span>
                </label>
              </div>
              <div className="cms-editor-actions">
                <button className="cms-primary-button" disabled={saving} onClick={() => void saveItem()} type="button">
                  {saving ? "저장 중" : "저장"}
                </button>
                {activeItem ? (
                  <button className="cms-danger-button" disabled={saving} onClick={() => void deleteItem()} type="button">
                    삭제
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
