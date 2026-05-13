export type CmsSectionKey = "platform-development" | "major-achievements";

export type CmsItemDto = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  clientName: string | null;
  periodLabel: string | null;
  summary: string;
  body: string | null;
  tags: string[];
  imageUrl: string | null;
  linkUrl: string | null;
  status: string;
  featured: boolean;
  visible: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CmsSectionDto = {
  id: string;
  key: CmsSectionKey;
  title: string;
  description: string | null;
  visible: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  items: CmsItemDto[];
};
