import crypto from "crypto";
import { prisma } from "../../lib/prisma";

export async function listCmsSections() {
  return prisma.cmsSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function getCmsSectionById(sectionId: string) {
  return prisma.cmsSection.findUnique({
    where: { id: sectionId },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function getCmsItemById(itemId: string) {
  return prisma.cmsItem.findUnique({
    where: { id: itemId },
  });
}

export async function createCmsSection(params: {
  key: string;
  title: string;
  description?: string;
  visible?: boolean;
  sortOrder?: number;
}) {
  return prisma.cmsSection.create({
    data: {
      id: crypto.randomUUID(),
      key: params.key,
      title: params.title,
      description: params.description,
      visible: params.visible ?? true,
      sortOrder: params.sortOrder ?? 0,
      updatedAt: new Date(),
    },
  });
}

export async function updateCmsSection(params: {
  sectionId: string;
  title: string;
  description?: string;
  visible: boolean;
  sortOrder: number;
}) {
  return prisma.cmsSection.update({
    where: { id: params.sectionId },
    data: {
      title: params.title,
      description: params.description,
      visible: params.visible,
      sortOrder: params.sortOrder,
      updatedAt: new Date(),
    },
  });
}

export async function createCmsItem(params: {
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
  return prisma.cmsItem.create({
    data: {
      id: crypto.randomUUID(),
      sectionId: params.sectionId,
      slug: params.slug,
      title: params.title,
      subtitle: params.subtitle,
      clientName: params.clientName,
      periodLabel: params.periodLabel,
      summary: params.summary,
      body: params.body,
      tags: params.tags,
      imageUrl: params.imageUrl,
      linkUrl: params.linkUrl,
      status: params.status ?? "published",
      featured: params.featured ?? false,
      visible: params.visible ?? true,
      sortOrder: params.sortOrder ?? 0,
      updatedAt: new Date(),
    },
  });
}

export async function updateCmsItem(params: {
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
  return prisma.cmsItem.update({
    where: { id: params.itemId },
    data: {
      slug: params.slug,
      title: params.title,
      subtitle: params.subtitle,
      clientName: params.clientName,
      periodLabel: params.periodLabel,
      summary: params.summary,
      body: params.body,
      tags: params.tags,
      imageUrl: params.imageUrl,
      linkUrl: params.linkUrl,
      status: params.status,
      featured: params.featured,
      visible: params.visible,
      sortOrder: params.sortOrder,
      updatedAt: new Date(),
    },
  });
}

export async function deleteCmsItem(itemId: string) {
  return prisma.cmsItem.delete({
    where: { id: itemId },
  });
}
