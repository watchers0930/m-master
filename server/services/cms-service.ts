import {
  createCmsItem,
  createCmsSection,
  deleteCmsItem,
  getCmsItemById,
  getCmsSectionById,
  listCmsSections,
  updateCmsItem,
  updateCmsSection,
} from "../repositories/cms-repository";
import { logger } from "../logger";
import type { CmsItemDto, CmsSectionDto, CmsSectionKey } from "../../types/cms";

const defaultSections: Array<{
  key: CmsSectionKey;
  title: string;
  description: string;
  sortOrder: number;
}> = [
  {
    key: "platform-development",
    title: "플랫폼 개발",
    description: "운영자가 직접 플랫폼 소개, 핵심 기능, 적용 산업을 관리하는 섹션입니다.",
    sortOrder: 10,
  },
  {
    key: "major-achievements",
    title: "주요 실적",
    description: "프로젝트 실적, 고객 사례, 대표 레퍼런스를 관리하는 섹션입니다.",
    sortOrder: 20,
  },
];

function buildFallbackSections(): CmsSectionDto[] {
  const now = new Date().toISOString();

  return defaultSections.map((section, index) => ({
    id: `fallback-${section.key}`,
    key: section.key,
    title: section.title,
    description: section.description,
    visible: true,
    sortOrder: section.sortOrder,
    createdAt: now,
    updatedAt: now,
    items: index === 0
      ? [
          {
            id: "fallback-platform-item",
            slug: "headless-cms-platform",
            title: "헤드리스 CMS 운영 구조",
            subtitle: "관리자에서 기능 소개와 적용 산업을 직접 갱신",
            clientName: "Internal",
            periodLabel: "2026",
            summary:
              "플랫폼개발 섹션은 서비스 소개, 핵심 기능, 산업별 적용 포인트를 관리자에서 수정하고 공개 페이지는 동일한 데이터를 바로 반영합니다.",
            body:
              "초기 데이터는 fallback 모드로 렌더링되고 있습니다. Neon DB 쿼터가 복구되면 /cms 편집 내용이 실제 DB에 영구 저장됩니다.",
            tags: ["Headless CMS", "Admin", "Content Ops"],
            imageUrl: null,
            linkUrl: "/cms",
            status: "fallback",
            featured: true,
            visible: true,
            sortOrder: 10,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [
          {
            id: "fallback-achievement-item",
            slug: "cms-managed-achievements",
            title: "주요실적 관리 구조",
            subtitle: "레퍼런스, 고객사, 기간, 태그를 일관되게 운영",
            clientName: "Internal",
            periodLabel: "2026",
            summary:
              "주요실적 섹션은 고객사명, 기간, 요약, 태그, 링크, 공개 여부를 한 화면에서 관리하도록 설계했습니다.",
            body:
              "현재는 DB 스키마 반영 전이므로 샘플 카드가 표시됩니다. 스키마가 반영되면 운영자가 입력한 실적 데이터가 그대로 노출됩니다.",
            tags: ["Portfolio", "Case Study", "Structured Content"],
            imageUrl: null,
            linkUrl: "/cms",
            status: "fallback",
            featured: false,
            visible: true,
            sortOrder: 10,
            createdAt: now,
            updatedAt: now,
          },
        ],
  }));
}

export class CmsSectionNotFoundError extends Error {
  constructor(sectionId: string) {
    super(`CMS 섹션을 찾을 수 없습니다: ${sectionId}`);
    this.name = "CmsSectionNotFoundError";
  }
}

export class CmsItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`CMS 항목을 찾을 수 없습니다: ${itemId}`);
    this.name = "CmsItemNotFoundError";
  }
}

function parseTags(tags: string | null) {
  if (!tags) {
    return [];
  }

  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function serializeItem(item: Awaited<ReturnType<typeof listCmsSections>>[number]["items"][number]): CmsItemDto {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    subtitle: item.subtitle,
    clientName: item.clientName,
    periodLabel: item.periodLabel,
    summary: item.summary,
    body: item.body,
    tags: parseTags(item.tags),
    imageUrl: item.imageUrl,
    linkUrl: item.linkUrl,
    status: item.status,
    featured: item.featured,
    visible: item.visible,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeSection(section: Awaited<ReturnType<typeof listCmsSections>>[number]): CmsSectionDto {
  return {
    id: section.id,
    key: section.key as CmsSectionKey,
    title: section.title,
    description: section.description,
    visible: section.visible,
    sortOrder: section.sortOrder,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
    items: section.items.map(serializeItem),
  };
}

async function ensureDefaultSections() {
  const existing = await listCmsSections();

  if (existing.length > 0) {
    return existing;
  }

  logger.info("cms.bootstrap.start");

  for (const section of defaultSections) {
    await createCmsSection(section);
  }

  logger.info("cms.bootstrap.success", {
    sectionCount: defaultSections.length,
  });

  return listCmsSections();
}

export async function getCmsSections() {
  try {
    const sections = await ensureDefaultSections();
    return sections.map(serializeSection);
  } catch (error) {
    logger.error("cms.sections.fallback", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return buildFallbackSections();
  }
}

export async function getCmsPublicSections() {
  try {
    const sections = await ensureDefaultSections();
    return sections.filter((section) => section.visible).map((section) => ({
      ...serializeSection(section),
      items: section.items.filter((item) => item.visible).map(serializeItem),
    }));
  } catch (error) {
    logger.error("cms.public.fallback", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return buildFallbackSections();
  }
}

export async function saveCmsSection(params: {
  sectionId: string;
  title: string;
  description?: string;
  visible: boolean;
  sortOrder: number;
}) {
  const existing = await getCmsSectionById(params.sectionId);

  if (!existing) {
    throw new CmsSectionNotFoundError(params.sectionId);
  }

  logger.info("cms.section.update.start", { sectionId: params.sectionId });
  await updateCmsSection(params);
  logger.info("cms.section.update.success", { sectionId: params.sectionId });

  return getCmsSections();
}

export async function addCmsItem(params: {
  sectionId: string;
  slug: string;
  title: string;
  subtitle?: string;
  clientName?: string;
  periodLabel?: string;
  summary: string;
  body?: string;
  tags?: string;
  imageUrl?: string;
  linkUrl?: string;
  status?: string;
  featured?: boolean;
  visible?: boolean;
  sortOrder?: number;
}) {
  const section = await getCmsSectionById(params.sectionId);

  if (!section) {
    throw new CmsSectionNotFoundError(params.sectionId);
  }

  logger.info("cms.item.create.start", {
    sectionId: params.sectionId,
    slug: params.slug,
  });

  await createCmsItem(params);

  logger.info("cms.item.create.success", {
    sectionId: params.sectionId,
    slug: params.slug,
  });

  return getCmsSections();
}

export async function saveCmsItem(params: {
  itemId: string;
  slug: string;
  title: string;
  subtitle?: string;
  clientName?: string;
  periodLabel?: string;
  summary: string;
  body?: string;
  tags?: string;
  imageUrl?: string;
  linkUrl?: string;
  status: string;
  featured: boolean;
  visible: boolean;
  sortOrder: number;
}) {
  const existing = await getCmsItemById(params.itemId);

  if (!existing) {
    throw new CmsItemNotFoundError(params.itemId);
  }

  logger.info("cms.item.update.start", {
    itemId: params.itemId,
    sectionId: existing.sectionId,
  });

  await updateCmsItem(params);

  logger.info("cms.item.update.success", {
    itemId: params.itemId,
    sectionId: existing.sectionId,
  });

  return getCmsSections();
}

export async function removeCmsItem(itemId: string) {
  const existing = await getCmsItemById(itemId);

  if (!existing) {
    throw new CmsItemNotFoundError(itemId);
  }

  logger.info("cms.item.delete.start", {
    itemId,
    sectionId: existing.sectionId,
  });

  await deleteCmsItem(itemId);

  logger.info("cms.item.delete.success", {
    itemId,
    sectionId: existing.sectionId,
  });

  return getCmsSections();
}
