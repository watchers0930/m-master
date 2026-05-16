export type ChannelKey = "blog" | "instagram" | "facebook";

export type SeoComplianceItem = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

export type SeoComplianceResult = {
  score: number;
  items: SeoComplianceItem[];
};

export type VariantSummary = {
  id: string;
  variantLabel: string;
  topic: string;
  objective?: string | null;
  adopted: boolean;
  status: string;
  blogTitle?: string;
  blogBodyLength?: number;
  seoScore?: number;
  reviewScores?: ReviewScores;
  createdAt: string;
};

export type VariantGroup = {
  groupId: string;
  variants: VariantSummary[];
};

export type ReviewScores = {
  brandAlignment: number;
  formatFit: number;
  ctaClarity: number;
  riskControl: number;
};

export type ReviewFinding = {
  channel: string;
  type: "brand" | "format" | "cta" | "risk";
  severity: "info" | "warning";
  message: string;
};

export type BlogStudioAsset = {
  id: string;
  channel: ChannelKey;
  title: string;
  body: string;
  cta: string;
  hashtags: string;
  metaDescription?: string | null;
};

export type ImageStudioVariant = {
  id: string;
  label: string;
  prompt: string;
  accent?: string;
  url?: string;
  selected?: boolean;
};

export type ImageStudioState = {
  channel: ChannelKey;
  prompt?: string | null;
  variants: Array<{
    id: string;
    role: string;
    url: string;
    width?: number | null;
    height?: number | null;
    selected: boolean;
  }>;
};

export type SourceFileDraft = {
  name: string;
  relativePath?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  lastModified?: string;
  excerpt?: string;
};

export type SourceAnalysisSummary = {
  totalFiles: number;
  filesWithExcerpt: number;
  fileTypeBreakdown: Array<{ key: string; count: number }>;
  topSourceFiles: Array<{ name: string; relativePath?: string; excerptLength: number }>;
  keywordHints: string[];
  excerptDigest: string;
};

export type ProjectListItem = {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  ga4PropertyId?: string | null;
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

export type EditableBrandProfileField = "summary" | "audience" | "tone" | "cta" | "bannedTerms";

export type ProjectDetail = {
  project: {
    id: string;
    name: string;
    domain?: string | null;
    industry?: string | null;
    ga4PropertyId?: string | null;
    workingPath?: string | null;
    status: string;
    wordpressSiteUrl?: string | null;
    wordpressUsername?: string | null;
    hasWordPressAppPassword?: boolean | null;
    wordpressStatus?: string | null;
    wordpressCategoryNames?: string | null;
    wordpressTagNames?: string | null;
    bloggerBlogId?: string | null;
    hasBloggerAccessToken?: boolean | null;
    bloggerStatus?: string | null;
    hasMetaAccessToken?: boolean | null;
    facebookPageId?: string | null;
    instagramBusinessAccountId?: string | null;
    automationMode?: "draft-only" | "approved-auto-publish" | "full-auto" | null;
    automationRequireReview?: boolean | null;
    automationMinOverallScore?: number | null;
    automationMinRiskScore?: number | null;
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
  latestContentJob?: {
    id: string;
    topic: string;
    objective?: string | null;
    status: string;
    publishProvider?: string | null;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
    publishedAt?: string | null;
  } | null;
  sourceAnalysis?: SourceAnalysisSummary | null;
};

export type StudioDetail = {
  project: {
    id: string;
    name: string;
    domain?: string | null;
    industry?: string | null;
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
    generationProvider: "openai" | "fallback";
    assets: Array<{
      channel: ChannelKey;
      title: string;
      body: string;
      cta: string;
      hashtags: string;
    }>;
    images: ImageStudioState[];
  };
  review: {
    scores: ReviewScores;
    findings: ReviewFinding[];
    status: "ready" | "needs-edit";
  };
};

export type StudioAsset = StudioDetail["draft"]["assets"][number];

export type ExportBundle = {
  generatedAt: string;
  jsonFilename: string;
  channels: Array<{
    channel: ChannelKey;
    filename: string;
    title: string;
    content: string;
    hashtags: string;
    hashtagsFilename?: string;
  }>;
};

export type ExportPreviewState = {
  bundle: ExportBundle | null;
  activeView: ChannelKey | "json";
};

export type BlogPublishPackage = {
  platform: "blog";
  projectId: string;
  contentJobId: string;
  status: string;
  updatedAt: string;
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  bodyHtml: string;
  htmlWarnings: string[];
  cta?: string | null;
  hashtags?: string | null;
  coverImageUrl?: string | null;
  sourceUrl?: string | null;
};

export type BlogPublishDraft = {
  title: string;
  slug: string;
  summary: string;
  bodyHtml: string;
};

export type WordPressPublishConfig = {
  bloggerBlogId: string;
  bloggerAccessToken: string;
  bloggerStatus: "draft" | "publish";
  metaAccessToken: string;
  facebookPageId: string;
  instagramBusinessAccountId: string;
  automationMode: "draft-only" | "approved-auto-publish" | "full-auto";
  automationRequireReview: boolean;
  automationMinOverallScore: string;
  automationMinRiskScore: string;
};

export type WordPressPublishResult = {
  provider: "blogger";
  postId: number | string;
  link: string;
  status: string;
  labels?: string[];
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
  sourceAnalysis: SourceAnalysisSummary;
};

export type ProjectActivityItem = {
  id: string;
  kind: "brand-draft" | "brand-approved" | "content-saved" | "publish-ready";
  title: string;
  description: string;
  timestamp: string;
};

export type MonthlyContentPlan = {
  id: string;
  projectId: string;
  monthKey: string;
  status: string;
  basisSummary?: string | null;
  autoGenerate: boolean;
  generatedAt?: string | null;
  lastExecutedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    sortOrder: number;
    weekLabel: string;
    publishAt?: string | null;
    topic: string;
    intentType?: string | null;
    objective?: string | null;
    rationale?: string | null;
    status: string;
    attemptCount: number;
    lastError?: string | null;
    reviewSnapshot?: {
      approved: boolean;
      averageScore: number;
      minOverallScore: number;
      minRiskScore: number;
      requireReview: boolean;
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
      message?: string | null;
    } | null;
    lastProcessedAt?: string | null;
    contentJobId?: string | null;
    generatedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ChannelPublicationSummary = {
  id: string;
  contentJobId: string;
  channel: string;
  provider: string;
  status: string;
  failureCategory?: "auth" | "config" | "network" | "rate_limit" | "media" | "validation" | "unknown" | null;
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  payloadSummary?: string | null;
  errorMessage?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationReadinessIssue = {
  id: string;
  severity: "blocking" | "warning" | "info";
  area: "context" | "analytics" | "meta" | "images" | "automation" | "operations";
  title: string;
  detail: string;
  recommendation?: string | null;
};

export type AutomationReadinessReport = {
  status: "ready" | "warning" | "blocked";
  generatedAt: string;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  issues: AutomationReadinessIssue[];
};

export type ContentJobDetail = {
  id: string;
  topic: string;
  objective?: string | null;
  status: string;
  generationProvider?: string | null;
  publishProvider?: string | null;
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  publications: ChannelPublicationSummary[];
  assets: Array<{
    id: string;
    channel: string;
    title?: string | null;
    body: string;
    cta?: string | null;
    hashtags?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    images: Array<{
      id: string;
      role: string;
      selected: boolean;
      width?: number | null;
      height?: number | null;
      url: string;
    }>;
  }>;
};

export type AutomationRunSummary = {
  executedAt: string;
  total: number;
  published: number;
  readyToPublish: number;
  needsReview: number;
  failed: number;
  results: Array<{
    planItemId: string;
    projectId: string;
    status: "published" | "ready_to_publish" | "needs_review" | "failed";
    contentJobId?: string | null;
    message: string;
  }>;
};

export type AutomationReviewResolution = {
  action: "approve" | "retry";
  planItemId: string;
  projectId: string;
  status: "published" | "ready_to_publish" | "needs_review" | "failed";
  contentJobId?: string | null;
  message: string;
};

export type AutomationTimelineKind =
  | "plan_approve"
  | "plan_retry"
  | "publication_retry"
  | "automation_run"
  | "review_approve"
  | "review_retry"
  | "publication_retry_single";

export type BulkOperationReport = {
  kind: AutomationTimelineKind;
  label: string;
  completed: number;
  failed: number;
  items: Array<{
    id: string;
    label: string;
    status: "success" | "failed";
    message: string;
  }>;
};

export type BulkOperationHistoryItem = BulkOperationReport & {
  id: string;
  actorLabel?: string | null;
  executionSource?: string | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineSectionId = "source" | "generation" | "ab" | "verify";

export type PipelineSectionLock = {
  source: boolean;
  generation: boolean;
  ab: boolean;
  verify: boolean;
};
