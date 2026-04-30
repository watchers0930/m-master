export type SourceFileDraft = {
  name: string;
  relativePath?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  lastModified?: string;
  excerpt?: string;
};

export type ProjectListItem = {
  id: string;
  name: string;
  domain?: string | null;
  workingPath?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestBrandProfile?: {
    id: string;
    version: number;
    summary: string;
    approved: boolean;
    updatedAt: string;
  } | null;
  topicCount: number;
  contentJobCount: number;
  topTopics: Array<{
    id: string;
    title: string;
    intentType?: string | null;
    score?: number | null;
  }>;
};

export type ProjectDetail = {
  project: {
    id: string;
    name: string;
    domain?: string | null;
    workingPath?: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  brandProfile: {
    id: string;
    version: number;
    summary: string;
    audience?: string | null;
    tone?: string | null;
    cta?: string | null;
    bannedTerms?: string | null;
    approved: boolean;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  topics: Array<{
    id: string;
    title: string;
    intentType?: string | null;
    score?: number | null;
    rationale?: string | null;
    createdAt: string;
  }>;
  sourceAnalysis?: {
    totalFiles: number;
    filesWithExcerpt: number;
    fileTypeBreakdown: Array<{ key: string; count: number }>;
    topSourceFiles: Array<{ name: string; relativePath?: string; excerptLength: number }>;
    keywordHints: string[];
    excerptDigest: string;
  } | null;
};

export type ProjectPreview = {
  brandProfile: {
    summary: string;
    audience?: string | null;
    tone?: string | null;
    cta?: string | null;
    bannedTerms?: string | null;
  };
  topics: Array<{
    id?: string;
    title: string;
    intentType?: string | null;
    score?: number | null;
    rationale?: string | null;
  }>;
  sourceAnalysis: {
    totalFiles: number;
    filesWithExcerpt: number;
    fileTypeBreakdown: Array<{ key: string; count: number }>;
    topSourceFiles: Array<{ name: string; relativePath?: string; excerptLength: number }>;
    keywordHints: string[];
    excerptDigest: string;
  };
};

export type StudioDetail = {
  project: {
    id: string;
    name: string;
    domain?: string | null;
    workingPath?: string | null;
    status: string;
  };
  brandProfile: {
    id: string;
    summary: string;
    audience?: string | null;
    tone?: string | null;
    cta?: string | null;
    bannedTerms?: string | null;
    approved: boolean;
  };
  topics: Array<{
    id: string;
    title: string;
    intentType?: string | null;
    score?: number | null;
  }>;
  draft: {
    topic: string;
    objective: string;
    assets: Array<{
      channel: "blog" | "instagram" | "facebook";
      title: string;
      body: string;
      cta: string;
    }>;
  };
  review: {
    scores: {
      brandAlignment: number;
      formatFit: number;
      ctaClarity: number;
      riskControl: number;
    };
    findings: Array<{
      channel: string;
      type: "brand" | "format" | "cta" | "risk";
      severity: "info" | "warning";
      message: string;
    }>;
    status: "ready" | "needs-edit";
  };
};
