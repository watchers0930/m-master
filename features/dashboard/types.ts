export type ChannelKey = "blog" | "instagram" | "facebook";

export type ImageStudioVariant = {
  id: string;
  label: string;
  prompt: string;
  accent?: string;
  url?: string;
  selected?: boolean;
};

export type ImageStudioState = {
  prompt: string;
  variants: ImageStudioVariant[];
  selectedVariantId?: string | null;
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
    metaTokenExpiresAt?: string | null;
    facebookPageId?: string | null;
    instagramBusinessAccountId?: string | null;
    hasOperationsAlertWebhook?: boolean | null;
    alertPolicyMode?: "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review" | null;
    alertQuietHoursStart?: string | null;
    alertQuietHoursEnd?: string | null;
    alertTimezone?: string | null;
    alertOnBlockedReadiness?: boolean | null;
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

export type ProjectOperatorRole = "viewer" | "analyst" | "reviewer" | "operator" | "owner";

export type ProjectOperatorSummary = {
  id: string;
  name: string;
  role: ProjectOperatorRole;
  active: boolean;
  lastUsedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ProjectOperatorSession = {
  id: string;
  projectId: string;
  name: string;
  role: ProjectOperatorRole;
  active: boolean;
  lastUsedAt?: string | null;
};

export type CredentialCheckRun = {
  id: string;
  service: "blogger" | "meta" | "ga4" | "alerts";
  kind: string;
  status: "ready" | "warning" | "failed";
  actorLabel?: string | null;
  summary: string;
  detail?: string | null;
  expiresAt?: string | null;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialHealthReport = {
  services: Array<{
    service: "blogger" | "meta" | "ga4" | "alerts";
    latest: CredentialCheckRun | null;
  }>;
  history: CredentialCheckRun[];
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
    images: Array<{
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

export type StudioAsset = StudioDetail["draft"]["assets"][number];

export type ProjectActivityItem = {
  id: string;
  kind: "brand-draft" | "brand-approved" | "content-saved" | "publish-ready";
  title: string;
  description: string;
  timestamp: string;
};

export type ReviewFinding = StudioDetail["review"]["findings"][number];

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

export type BlogPublishResult = {
  provider: "blogger";
  postId: number | string;
  link: string;
  status: string;
  labels?: string[];
};
