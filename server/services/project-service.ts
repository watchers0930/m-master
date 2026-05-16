import crypto from "crypto";
import { logger } from "../logger";
import {
  approveBrandProfileVersion,
  attachContentJobToPlanItem,
  createAutomationBatchRun,
  createContentJobVariant,
  createChannelPublication,
  createImageJobWithAssets,
  createOrUpdateContentJobWithAssets,
  createProjectOperator,
  createProjectWithSeeds,
  deleteProjectById,
  adoptVariant,
  getProjectChannelPublication,
  getProjectContentJob,
  getProjectContentPlanItem,
  getLatestProjectContentPlan,
  getProjectContentPlan,
  listProjectChannelPublications,
  listDueContentPlanItems,
  getProjectContentPlanItemByContentJobId,
  getLatestVariantGroup,
  getProjectDetail,
  getVariantGroup,
  listProjectBrandProfiles,
  listProjectAutomationBatchRuns,
  listProjectContentJobs,
  listProjects,
  listProjectsForOperatorIdentity,
  listUnclaimedProjects,
  replaceProjectTopics,
  saveBrandProfileDraft,
  saveProjectContentPlan,
  markContentPlanItemStatus,
  saveLatestContentJobPublishResult,
  saveLatestContentJobAssets,
  updateContentPlanItemReviewState,
  updateContentAssetDraft,
  selectImageAssetForContentAsset,
  updateProjectSettings,
  updateLatestContentJobStatus,
} from "../repositories/project-repository";
import { getAnalyticsSnapshot } from "./analytics-service";
import { buildMonthlyContentPlan } from "./content-plan-service";
import { recordCredentialRotation } from "./credential-check-service";
import { decryptSecret, encryptSecret } from "./credential-vault-service";
import { buildPublicImageAssetUrl } from "./image-delivery-service";
import { MetaPublishError, publishToFacebookPage, publishToInstagram } from "./meta-publish-service";
import { buildContextDraft } from "./context-draft-service";
import {
  buildGeneratedStudioSeed,
  buildVariantStudioSeed,
  buildDerivedChannelAssets,
  type ContentGenerationProvider,
  type VariantAngle,
} from "./content-generation-service";
import { buildImageVariants } from "./image-studio-service";
import { buildBlogHtml, buildBlogPublishPackage, createExportSlug } from "./blog-publish-service";
import { buildReviewSummary } from "./review-service";
import { analyzeSourceFiles } from "./source-analysis-service";
import { buildStudioSeed } from "./studio-seed-service";
import { buildTopicRecommendations, normalizeTopicTitle } from "./topic-recommendation-service";
import { fetchWebsiteSource } from "./website-source-service";
import { BloggerPublishError, publishToBlogger } from "./blogger-publish-service";
import type { CreateProjectInput } from "../validators/project-validator";

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectContentNotFoundError extends Error {
  constructor(projectId: string) {
    super(`프로젝트 콘텐츠를 찾을 수 없습니다: ${projectId}`);
    this.name = "ProjectContentNotFoundError";
  }
}

export class ProjectImageNotFoundError extends Error {
  constructor(projectId: string) {
    super(`프로젝트 이미지 자산을 찾을 수 없습니다: ${projectId}`);
    this.name = "ProjectImageNotFoundError";
  }
}

export class ProjectContextApprovalRequiredError extends Error {
  constructor(projectId: string) {
    super(`컨텍스트 승인이 필요합니다: ${projectId}`);
    this.name = "ProjectContextApprovalRequiredError";
  }
}

export class ProjectPublishSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPublishSafetyError";
  }
}

export class ProjectPlanItemNotFoundError extends Error {
  constructor(planItemId: string) {
    super(`계획 항목을 찾을 수 없습니다: ${planItemId}`);
    this.name = "ProjectPlanItemNotFoundError";
  }
}

export class ProjectAutomationReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectAutomationReadinessError";
  }
}

export { BloggerPublishError };

type AutomationMode = "draft-only" | "approved-auto-publish" | "full-auto";
type AutomationExecutionStatus = "published" | "ready_to_publish" | "needs_review" | "failed";
type AutomationPlanItemRecord = Awaited<ReturnType<typeof listDueContentPlanItems>>[number];
type ReviewGuardrailResult = ReturnType<typeof evaluateReviewGuardrail>;
type AutomationBatchRunItem = {
  id: string;
  label: string;
  status: "success" | "failed";
  message: string;
};
type AutomationTimelineKind =
  | "plan_approve"
  | "plan_retry"
  | "publication_retry"
  | "automation_run"
  | "review_approve"
  | "review_retry"
  | "publication_retry_single";
type AutomationReadinessIssue = {
  id: string;
  severity: "blocking" | "warning" | "info";
  area: "context" | "analytics" | "wordpress" | "meta" | "images" | "automation" | "operations";
  title: string;
  detail: string;
  recommendation?: string | null;
};

function isLegacyContentShape(params: {
  topic: string;
  assets: Array<{ body: string }>;
}) {
  const joinedBody = params.assets.map((asset) => asset.body).join("\n");

  return (
    /(?:api|ts|admin|post).*,/.test(params.topic.toLowerCase()) ||
    params.topic.includes("------") ||
    joinedBody.includes("작업 폴더 경로는") ||
    joinedBody.length > 2400
  );
}

function requireApprovedBrandProfile(
  record: Awaited<ReturnType<typeof getProjectDetail>>,
  projectId: string,
): NonNullable<Awaited<ReturnType<typeof getProjectDetail>>> & {
  brandProfile: NonNullable<NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>["brandProfile"]>;
} {
  if (!record || !record.brandProfile) {
    throw new ProjectNotFoundError(projectId);
  }

  if (!record.brandProfile.approved) {
    throw new ProjectContextApprovalRequiredError(projectId);
  }

  return record as NonNullable<Awaited<ReturnType<typeof getProjectDetail>>> & {
    brandProfile: NonNullable<NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>["brandProfile"]>;
  };
}

function normalizeAutomationMode(mode?: string | null): AutomationMode {
  if (mode === "approved-auto-publish" || mode === "full-auto") {
    return mode;
  }

  return "draft-only";
}

function hasMetaAutomationConfig(params: {
  facebookPageId?: string | null;
  instagramBusinessAccountId?: string | null;
  metaAccessToken?: string | null;
  metaAccessTokenEncrypted?: string | null;
}) {
  return Boolean(
    (params.metaAccessToken || params.metaAccessTokenEncrypted) &&
      params.facebookPageId &&
      params.instagramBusinessAccountId,
  );
}

function parseAutomationBatchRunItems(snapshot?: string | null): AutomationBatchRunItem[] {
  if (!snapshot) {
    return [];
  }

  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.label !== "string" ||
        typeof candidate.message !== "string" ||
        (candidate.status !== "success" && candidate.status !== "failed")
      ) {
        return [];
      }

      return [
        {
          id: candidate.id,
          label: candidate.label,
          status: candidate.status,
          message: candidate.message,
        },
      ];
    });
  } catch {
    return [];
  }
}

function classifyFailureCategory(message?: string | null): "auth" | "config" | "network" | "rate_limit" | "media" | "validation" | "unknown" | null {
  if (!message) {
    return null;
  }

  const normalized = message.toLowerCase();

  if (
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("access token") ||
    normalized.includes("oauth") ||
    normalized.includes("인증") ||
    normalized.includes("권한")
  ) {
    return "auth";
  }

  if (
    normalized.includes("missing") ||
    normalized.includes("required") ||
    normalized.includes("필요") ||
    normalized.includes("설정") ||
    normalized.includes("not found")
  ) {
    return "config";
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("econn") ||
    normalized.includes("dns")
  ) {
    return "network";
  }

  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429")
  ) {
    return "rate_limit";
  }

  if (
    normalized.includes("image") ||
    normalized.includes("media") ||
    normalized.includes("featured image") ||
    normalized.includes("대표 이미지")
  ) {
    return "media";
  }

  if (
    normalized.includes("invalid") ||
    normalized.includes("unsupported") ||
    normalized.includes("형식") ||
    normalized.includes("validation")
  ) {
    return "validation";
  }

  return "unknown";
}

function getAverageReviewScore(scores: {
  brandAlignment: number;
  formatFit: number;
  ctaClarity: number;
  riskControl: number;
}) {
  return Math.round((scores.brandAlignment + scores.formatFit + scores.ctaClarity + scores.riskControl) / 4);
}

function evaluateReviewGuardrail(params: {
  requireReview: boolean;
  minOverallScore: number;
  minRiskScore: number;
  review: ReturnType<typeof buildReviewSummary>;
}) {
  const averageScore = getAverageReviewScore(params.review.scores);

  if (!params.requireReview) {
    return {
      approved: true,
      averageScore,
      message: null,
    };
  }

  if (params.review.status !== "ready") {
    return {
      approved: false,
      averageScore,
      message: `리뷰 경고가 남아 있어 자동 게시를 차단했습니다. 종합 ${averageScore}점, 리스크 ${params.review.scores.riskControl}점입니다.`,
    };
  }

  if (averageScore < params.minOverallScore) {
    return {
      approved: false,
      averageScore,
      message: `종합 점수 ${averageScore}점이 자동화 기준 ${params.minOverallScore}점보다 낮아 게시를 차단했습니다.`,
    };
  }

  if (params.review.scores.riskControl < params.minRiskScore) {
    return {
      approved: false,
      averageScore,
      message: `리스크 점수 ${params.review.scores.riskControl}점이 자동화 기준 ${params.minRiskScore}점보다 낮아 게시를 차단했습니다.`,
    };
  }

  return {
    approved: true,
    averageScore,
    message: null,
  };
}

function buildReviewSnapshot(params: {
  guardrail: ReviewGuardrailResult;
  review: ReturnType<typeof buildReviewSummary>;
  requireReview: boolean;
  minOverallScore: number;
  minRiskScore: number;
}) {
  return JSON.stringify({
    approved: params.guardrail.approved,
    averageScore: params.guardrail.averageScore,
    minOverallScore: params.minOverallScore,
    minRiskScore: params.minRiskScore,
    requireReview: params.requireReview,
    scores: params.review.scores,
    findings: params.review.findings,
    message: params.guardrail.message,
  });
}

function parseReviewSnapshot(snapshot?: string | null) {
  if (!snapshot) {
    return null;
  }

  try {
    return JSON.parse(snapshot) as {
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
    };
  } catch {
    return null;
  }
}

async function publishProjectSocialChannels(params: {
  project: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>["project"];
  latestContentJob: NonNullable<NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>["latestContentJob"]>;
  metaAccessToken?: string | null;
}) {
  const { project, latestContentJob, metaAccessToken } = params;

  if (!metaAccessToken) {
    return;
  }

  const instagramAsset = latestContentJob.assets.find((asset) => asset.channel === "instagram");
  const facebookAsset = latestContentJob.assets.find((asset) => asset.channel === "facebook");
  const socialLink = project.domain?.startsWith("http")
    ? project.domain
    : project.domain
      ? `https://${project.domain}`
      : null;

  if (instagramAsset && project.instagramBusinessAccountId) {
    const selectedInstagramImage =
      instagramAsset.imageJobs.flatMap((job) => job.imageAssets).find((image) => image.selected) ||
      instagramAsset.imageJobs.flatMap((job) => job.imageAssets)[0] ||
      null;
    const instagramImageUrl = selectedInstagramImage
      ? buildPublicImageAssetUrl(selectedInstagramImage.id)
      : null;

    try {
      const instagramPost = await publishToInstagram({
        instagramBusinessAccountId: project.instagramBusinessAccountId,
        accessToken: metaAccessToken,
        imageUrl: instagramImageUrl || "",
        caption: buildChannelMessage({
          title: instagramAsset.title,
          body: instagramAsset.body,
          cta: instagramAsset.cta,
          hashtags: instagramAsset.hashtags,
        }),
      });

      await createChannelPublication({
        contentJobId: latestContentJob.id,
        channel: "instagram",
        provider: "meta-instagram",
        status: "published",
        externalPostId: instagramPost.id,
        externalPostUrl: instagramPost.url,
        payloadSummary: instagramAsset.title || instagramAsset.body.slice(0, 140),
        publishedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "인스타그램 게시에 실패했습니다.";
      await createChannelPublication({
        contentJobId: latestContentJob.id,
        channel: "instagram",
        provider: "meta-instagram",
        status: "failed",
        errorMessage: message.slice(0, 4000),
        payloadSummary: instagramAsset.title || instagramAsset.body.slice(0, 140),
      });
    }
  }

  if (facebookAsset && project.facebookPageId) {
    try {
      const facebookPost = await publishToFacebookPage({
        pageId: project.facebookPageId,
        accessToken: metaAccessToken,
        message: buildChannelMessage({
          title: facebookAsset.title,
          body: facebookAsset.body,
          cta: facebookAsset.cta,
          hashtags: facebookAsset.hashtags,
        }),
        link: socialLink,
      });

      await createChannelPublication({
        contentJobId: latestContentJob.id,
        channel: "facebook",
        provider: "meta-facebook",
        status: "published",
        externalPostId: facebookPost.id,
        externalPostUrl: facebookPost.url,
        payloadSummary: facebookAsset.title || facebookAsset.body.slice(0, 140),
        publishedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "페이스북 게시에 실패했습니다.";
      await createChannelPublication({
        contentJobId: latestContentJob.id,
        channel: "facebook",
        provider: "meta-facebook",
        status: "failed",
        errorMessage: message.slice(0, 4000),
        payloadSummary: facebookAsset.title || facebookAsset.body.slice(0, 140),
      });
    }
  }
}

async function processAutomationPlanItem(item: AutomationPlanItemRecord) {
  const projectId = item.contentPlan.projectId;

  await generateProjectContent({
    projectId,
    topic: item.topic,
    planItemId: item.id,
    objective: item.objective ?? undefined,
    derivationMode: "blog-first",
  });

  const refreshedRecord = requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
  const latestContentJob = refreshedRecord.latestContentJob;

  if (!latestContentJob) {
    throw new ProjectContentNotFoundError(projectId);
  }

  const review = buildReviewSummary({
    summary: refreshedRecord.brandProfile.summary,
    cta: refreshedRecord.brandProfile.cta,
    bannedTerms: refreshedRecord.brandProfile.bannedTerms,
    assets: latestContentJob.assets.map((asset) => ({
      channel: asset.channel,
      title: asset.title,
      body: asset.body,
      cta: asset.cta,
      hashtags: asset.hashtags,
    })),
  });
  const guardrail = evaluateReviewGuardrail({
    requireReview: refreshedRecord.project.automationRequireReview,
    minOverallScore: refreshedRecord.project.automationMinOverallScore,
    minRiskScore: refreshedRecord.project.automationMinRiskScore,
    review,
  });
  const reviewSnapshot = buildReviewSnapshot({
    guardrail,
    review,
    requireReview: refreshedRecord.project.automationRequireReview,
    minOverallScore: refreshedRecord.project.automationMinOverallScore,
    minRiskScore: refreshedRecord.project.automationMinRiskScore,
  });
  const automationMode = normalizeAutomationMode(refreshedRecord.project.automationMode);

  if (automationMode === "draft-only") {
    await updateLatestContentJobStatus(projectId, "ready_to_publish");
    await markContentPlanItemStatus({
      planItemId: item.id,
      status: "ready_to_publish",
      contentJobId: latestContentJob.id,
      generatedAt: new Date(),
      lastError: null,
      reviewSnapshot,
    });

    return {
      planItemId: item.id,
      projectId,
      status: "ready_to_publish" as AutomationExecutionStatus,
      contentJobId: latestContentJob.id,
      message: `${item.topic} 콘텐츠를 생성했습니다. 자동화 모드가 draft-only라 게시는 보류했습니다.`,
    };
  }

  if (!guardrail.approved) {
    await updateLatestContentJobStatus(projectId, "needs_review");
    await markContentPlanItemStatus({
      planItemId: item.id,
      status: "needs_review",
      contentJobId: latestContentJob.id,
      generatedAt: new Date(),
      lastError: guardrail.message,
      reviewSnapshot,
    });

    return {
      planItemId: item.id,
      projectId,
      status: "needs_review" as AutomationExecutionStatus,
      contentJobId: latestContentJob.id,
      message: guardrail.message || "리뷰 가드레일에 걸려 자동 게시가 차단되었습니다.",
    };
  }

  const storedBloggerAccessToken = decryptSecret(item.contentPlan.project.bloggerAccessTokenEncrypted);
  const hasBloggerAutomation =
    Boolean(item.contentPlan.project.bloggerBlogId) &&
    Boolean(storedBloggerAccessToken);

  const publish = await markProjectReadyForPublish(
    projectId,
    hasBloggerAutomation
      ? {
          blogger: {
            blogId: item.contentPlan.project.bloggerBlogId || "",
            accessToken: storedBloggerAccessToken || "",
            status: item.contentPlan.project.bloggerStatus === "publish" ? "publish" : "draft",
          },
        }
      : undefined,
  );
  const metaAccessToken = decryptSecret(item.contentPlan.project.metaAccessTokenEncrypted);
  const hasMetaAutomation = hasMetaAutomationConfig({
    facebookPageId: item.contentPlan.project.facebookPageId,
    instagramBusinessAccountId: item.contentPlan.project.instagramBusinessAccountId,
    metaAccessToken,
  });

  if (automationMode === "full-auto" && hasMetaAutomation) {
    await publishProjectSocialChannels({
      project: item.contentPlan.project,
      latestContentJob,
      metaAccessToken,
    });
  }

  await markContentPlanItemStatus({
    planItemId: item.id,
    status: publish.status === "published" ? "published" : "ready_to_publish",
    contentJobId: publish.contentJobId,
    generatedAt: new Date(),
    lastError: null,
    reviewSnapshot,
  });

  return {
    planItemId: item.id,
    projectId,
    status: (publish.status === "published" ? "published" : "ready_to_publish") as AutomationExecutionStatus,
    contentJobId: publish.contentJobId,
    message: hasBloggerAutomation
      ? automationMode === "full-auto" && hasMetaAutomation
        ? `${item.topic} 콘텐츠를 생성하고 Blogger 및 소셜 자동 게시까지 처리했습니다.`
        : `${item.topic} 콘텐츠를 생성하고 Blogger 자동 게시까지 처리했습니다.`
      : `${item.topic} 콘텐츠를 생성하고 발행 준비 상태로 전환했습니다.`,
  };
}

function serializeProjectListItem(item: Awaited<ReturnType<typeof listProjects>>[number]) {
  const latestProfile = item.brandProfiles[0] ?? null;

  return {
    id: item.id,
    name: item.name,
    domain: item.domain,
    industry: item.industry,
    workingPath: item.workingPath,
    ga4PropertyId: item.ga4PropertyId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    latestBrandProfile: latestProfile
      ? {
          id: latestProfile.id,
          version: latestProfile.version,
          summary: latestProfile.summary,
          approved: latestProfile.approved,
          updatedAt: latestProfile.updatedAt,
        }
      : null,
    topicCount: item._count.topics,
    contentJobCount: item._count.contentJobs,
  };
}

function serializeProjectDetail(record: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>) {
  return {
    project: {
      id: record.project.id,
      name: record.project.name,
      domain: record.project.domain,
      industry: record.project.industry,
      workingPath: record.project.workingPath,
      ga4PropertyId: record.project.ga4PropertyId,
      status: record.project.status,
      wordpressSiteUrl: record.project.wordpressSiteUrl,
      wordpressUsername: record.project.wordpressUsername,
      hasWordPressAppPassword: Boolean(record.project.wordpressAppPasswordEncrypted),
      wordpressStatus: record.project.wordpressStatus,
      wordpressCategoryNames: record.project.wordpressCategoryNames,
      wordpressTagNames: record.project.wordpressTagNames,
      bloggerBlogId: record.project.bloggerBlogId,
      hasBloggerAccessToken: Boolean(record.project.bloggerAccessTokenEncrypted),
      bloggerStatus: record.project.bloggerStatus,
      hasMetaAccessToken: Boolean(record.project.metaAccessTokenEncrypted),
      metaTokenExpiresAt: record.project.metaTokenExpiresAt?.toISOString() ?? null,
      facebookPageId: record.project.facebookPageId,
      instagramBusinessAccountId: record.project.instagramBusinessAccountId,
      hasOperationsAlertWebhook: Boolean(record.project.operationsAlertWebhookEncrypted),
      alertPolicyMode: record.project.alertPolicyMode,
      alertQuietHoursStart: record.project.alertQuietHoursStart,
      alertQuietHoursEnd: record.project.alertQuietHoursEnd,
      alertTimezone: record.project.alertTimezone,
      alertOnBlockedReadiness: record.project.alertOnBlockedReadiness,
      automationMode: normalizeAutomationMode(record.project.automationMode),
      automationRequireReview: record.project.automationRequireReview,
      automationMinOverallScore: record.project.automationMinOverallScore,
      automationMinRiskScore: record.project.automationMinRiskScore,
      createdAt: record.project.createdAt,
      updatedAt: record.project.updatedAt,
    },
    brandProfile: record.brandProfile
      ? {
          id: record.brandProfile.id,
          version: record.brandProfile.version,
          summary: record.brandProfile.summary,
          audience: record.brandProfile.audience,
          tone: record.brandProfile.tone,
          cta: record.brandProfile.cta,
          bannedTerms: record.brandProfile.bannedTerms,
          approved: record.brandProfile.approved,
          approvedAt: record.brandProfile.approvedAt,
          createdAt: record.brandProfile.createdAt,
          updatedAt: record.brandProfile.updatedAt,
        }
      : null,
    topics: record.topics.map((topic) => ({
      id: topic.id,
      title: normalizeTopicTitle(topic.title, record.project.name),
      intentType: topic.intentType,
      score: topic.score,
      rationale: topic.rationale,
      createdAt: topic.createdAt,
    })),
    latestContentJob: record.latestContentJob
      ? {
          id: record.latestContentJob.id,
          topic: record.latestContentJob.topic,
          objective: record.latestContentJob.objective,
          status: record.latestContentJob.status,
          publishProvider: record.latestContentJob.publishProvider,
          externalPostId: record.latestContentJob.externalPostId,
          externalPostUrl: record.latestContentJob.externalPostUrl,
          publishedAt: record.latestContentJob.publishedAt?.toISOString() ?? null,
          publications: record.latestContentJob.publications.map((publication) => ({
            id: publication.id,
            channel: publication.channel,
            provider: publication.provider,
            status: publication.status,
            externalPostId: publication.externalPostId,
            externalPostUrl: publication.externalPostUrl,
            payloadSummary: publication.payloadSummary,
            errorMessage: publication.errorMessage,
            publishedAt: publication.publishedAt?.toISOString() ?? null,
            createdAt: publication.createdAt.toISOString(),
            updatedAt: publication.updatedAt.toISOString(),
          })),
          createdAt: record.latestContentJob.createdAt,
          updatedAt: record.latestContentJob.updatedAt,
          assets: record.latestContentJob.assets.map((asset) => ({
            id: asset.id,
            channel: asset.channel,
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
            version: asset.version,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            imageJobs: asset.imageJobs.map((job) => ({
              id: job.id,
              channelPreset: job.channelPreset,
              prompt: job.prompt,
              status: job.status,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              imageAssets: job.imageAssets.map((imageAsset) => ({
                id: imageAsset.id,
                role: imageAsset.role,
                originalPath: imageAsset.originalPath,
                composedPath: imageAsset.composedPath,
                width: imageAsset.width,
                height: imageAsset.height,
                selected: imageAsset.selected,
                version: imageAsset.version,
                createdAt: imageAsset.createdAt,
                updatedAt: imageAsset.updatedAt,
              })),
            })),
          })),
        }
      : null,
  };
}

function serializeContentPlan(plan: NonNullable<Awaited<ReturnType<typeof getProjectContentPlan>>>) {
  return {
    id: plan.id,
    projectId: plan.projectId,
    monthKey: plan.monthKey,
    status: plan.status,
    basisSummary: plan.basisSummary,
    autoGenerate: plan.autoGenerate,
    generatedAt: plan.generatedAt?.toISOString() ?? null,
    lastExecutedAt: plan.lastExecutedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    items: plan.items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      weekLabel: item.weekLabel,
      publishAt: item.publishAt?.toISOString() ?? null,
      topic: item.topic,
      intentType: item.intentType,
      objective: item.objective,
      rationale: item.rationale,
      status: item.status,
      attemptCount: item.attemptCount,
      lastError: item.lastError,
      reviewSnapshot: parseReviewSnapshot(item.reviewSnapshot),
      lastProcessedAt: item.lastProcessedAt?.toISOString() ?? null,
      contentJobId: item.contentJobId,
      generatedAt: item.generatedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

function buildChannelMessage(params: {
  title?: string | null;
  body: string;
  cta?: string | null;
  hashtags?: string | null;
}) {
  return [params.title, "", params.body, "", params.cta, "", params.hashtags]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2200)
    .trim();
}

export async function createProject(
  input: CreateProjectInput,
  options?: {
    creatorOperator?: {
      name: string;
      accessKeyHash: string;
    } | null;
  },
) {
  const enrichedInput = await enrichInputWithWebsiteSource(input);

  logger.info("project.create.start", {
    name: enrichedInput.name,
    domain: enrichedInput.domain,
    hasWorkingPath: Boolean(enrichedInput.workingPath),
    sourceFileCount: enrichedInput.sourceFiles.length,
  });

  const sourceAnalysis = analyzeSourceFiles(enrichedInput.sourceFiles);
  const contextDraft = buildContextDraft(enrichedInput, sourceAnalysis);
  const topics = buildTopicRecommendations({
    projectName: enrichedInput.name,
    domain: enrichedInput.domain,
    contextDraft,
    sourceAnalysis,
  });

  const projectId = await createProjectWithSeeds({
    project: enrichedInput,
    brandProfile: contextDraft,
    topics,
  });

  if (options?.creatorOperator) {
    await createProjectOperator({
      projectId,
      name: options.creatorOperator.name,
      role: "owner",
      accessKeyHash: options.creatorOperator.accessKeyHash,
    });
  }

  logger.info("project.create.success", {
    projectId,
    topicCount: topics.length,
  });

  const project = await getProjectById(projectId);

  return {
    ...project,
    sourceAnalysis,
  };
}

export async function getProjectList() {
  const projects = await listProjects();
  return projects.map(serializeProjectListItem);
}

export async function getProjectListForOperatorIdentity(params: {
  name: string;
  accessKeyHash: string;
}) {
  const projects = await listProjectsForOperatorIdentity({
    name: params.name.trim(),
    accessKeyHash: params.accessKeyHash,
  });

  return projects.map(serializeProjectListItem);
}

export async function getProjectListForOperatorCredentials(params: {
  name: string;
  accessKey: string;
}) {
  const normalizedName = params.name.trim();
  const normalizedAccessKey = params.accessKey.trim();

  if (!normalizedName || !normalizedAccessKey) {
    return [];
  }

  const accessKeyHash = crypto.createHash("sha256").update(normalizedAccessKey).digest("hex");
  return getProjectListForOperatorIdentity({
    name: normalizedName,
    accessKeyHash,
  });
}

export async function getUnclaimedProjectList() {
  const projects = await listUnclaimedProjects();
  return projects.map(serializeProjectListItem);
}
export async function deleteProject(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  await deleteProjectById(projectId);
  return { id: projectId };
}

export async function saveProjectSettings(params: {
  projectId: string;
  industry?: string;
  ga4PropertyId?: string;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressAppPassword?: string;
  wordpressStatus?: "draft" | "publish";
  wordpressCategoryNames?: string;
  wordpressTagNames?: string;
  bloggerBlogId?: string;
  bloggerAccessToken?: string;
  bloggerStatus?: "draft" | "publish";
  metaAccessToken?: string;
  metaTokenExpiresAt?: string;
  facebookPageId?: string;
  instagramBusinessAccountId?: string;
  operationsAlertWebhook?: string;
  alertPolicyMode?: "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review";
  alertQuietHoursStart?: string;
  alertQuietHoursEnd?: string;
  alertTimezone?: string;
  alertOnBlockedReadiness?: boolean;
  automationMode?: AutomationMode;
  automationRequireReview?: boolean;
  automationMinOverallScore?: number;
  automationMinRiskScore?: number;
  actorLabel?: string | null;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  await updateProjectSettings({
    projectId: params.projectId,
    industry: params.industry,
    ga4PropertyId: params.ga4PropertyId,
    wordpressSiteUrl: params.wordpressSiteUrl,
    wordpressUsername: params.wordpressUsername,
    wordpressAppPasswordEncrypted:
      params.wordpressAppPassword !== undefined
        ? encryptSecret(params.wordpressAppPassword) ?? null
        : undefined,
    wordpressStatus: params.wordpressStatus,
    wordpressCategoryNames: params.wordpressCategoryNames,
    wordpressTagNames: params.wordpressTagNames,
    bloggerBlogId: params.bloggerBlogId,
    bloggerAccessTokenEncrypted:
      params.bloggerAccessToken !== undefined
        ? encryptSecret(params.bloggerAccessToken) ?? null
        : undefined,
    bloggerStatus: params.bloggerStatus,
    metaAccessTokenEncrypted:
      params.metaAccessToken !== undefined
        ? encryptSecret(params.metaAccessToken) ?? null
        : undefined,
    metaTokenExpiresAt: params.metaTokenExpiresAt ? new Date(params.metaTokenExpiresAt) : undefined,
    facebookPageId: params.facebookPageId,
    instagramBusinessAccountId: params.instagramBusinessAccountId,
    operationsAlertWebhookEncrypted:
      params.operationsAlertWebhook !== undefined
        ? encryptSecret(params.operationsAlertWebhook) ?? null
        : undefined,
    alertPolicyMode: params.alertPolicyMode,
    alertQuietHoursStart: params.alertQuietHoursStart,
    alertQuietHoursEnd: params.alertQuietHoursEnd,
    alertTimezone: params.alertTimezone,
    alertOnBlockedReadiness: params.alertOnBlockedReadiness,
    automationMode: params.automationMode,
    automationRequireReview: params.automationRequireReview,
    automationMinOverallScore: params.automationMinOverallScore,
    automationMinRiskScore: params.automationMinRiskScore,
  });

  if (params.bloggerAccessToken !== undefined) {
    await recordCredentialRotation({
      projectId: params.projectId,
      service: "blogger",
      actorLabel: params.actorLabel ?? null,
      summary: params.bloggerAccessToken ? "Blogger access token을 갱신했습니다." : "Blogger access token을 제거했습니다.",
      detail: params.bloggerAccessToken ? "프로젝트 설정 화면에서 Blogger access token을 교체했습니다." : "프로젝트 설정에서 Blogger access token을 비웠습니다.",
    });
  }

  if (params.metaAccessToken !== undefined) {
    await recordCredentialRotation({
      projectId: params.projectId,
      service: "meta",
      actorLabel: params.actorLabel ?? null,
      summary: params.metaAccessToken ? "Meta Access Token을 갱신했습니다." : "Meta Access Token을 제거했습니다.",
      detail: params.metaAccessToken ? "프로젝트 설정 화면에서 Meta 토큰을 교체했습니다." : "프로젝트 설정에서 Meta 토큰을 비웠습니다.",
      expiresAt: params.metaTokenExpiresAt ? new Date(params.metaTokenExpiresAt) : null,
    });
  }

  if (params.operationsAlertWebhook !== undefined) {
    await recordCredentialRotation({
      projectId: params.projectId,
      service: "alerts",
      actorLabel: params.actorLabel ?? null,
      summary: params.operationsAlertWebhook ? "운영 알림 웹훅을 갱신했습니다." : "운영 알림 웹훅을 제거했습니다.",
      detail: params.operationsAlertWebhook ? "프로젝트 설정 화면에서 운영 알림 채널을 교체했습니다." : "프로젝트 설정에서 운영 알림 웹훅을 비웠습니다.",
    });
  }

  return getProjectById(params.projectId);
}

export async function getProjectById(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    logger.error("project.get.not_found", { projectId });
    throw new ProjectNotFoundError(projectId);
  }

  return serializeProjectDetail(record);
}

export async function getProjectMonthlyPlan(projectId: string, monthKey?: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const plan = monthKey
    ? await getProjectContentPlan(projectId, monthKey)
    : await getLatestProjectContentPlan(projectId);

  return plan ? serializeContentPlan(plan) : null;
}

export async function getProjectChannelPublicationHistory(projectId: string, limit?: number) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const publications = await listProjectChannelPublications(projectId, limit);
  return publications.map((publication) => ({
    id: publication.id,
    contentJobId: publication.contentJobId,
    channel: publication.channel,
    provider: publication.provider,
    status: publication.status,
    failureCategory: classifyFailureCategory(publication.errorMessage),
    externalPostId: publication.externalPostId,
    externalPostUrl: publication.externalPostUrl,
    payloadSummary: publication.payloadSummary,
    errorMessage: publication.errorMessage,
    publishedAt: publication.publishedAt?.toISOString() ?? null,
    createdAt: publication.createdAt.toISOString(),
    updatedAt: publication.updatedAt.toISOString(),
  }));
}

export async function getProjectContentJobDetail(params: {
  projectId: string;
  contentJobId: string;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const contentJob = await getProjectContentJob(params);

  if (!contentJob) {
    throw new ProjectContentNotFoundError(params.projectId);
  }

  return {
    id: contentJob.id,
    topic: contentJob.topic,
    objective: contentJob.objective,
    status: contentJob.status,
    generationProvider: contentJob.generationProvider,
    publishProvider: contentJob.publishProvider,
    externalPostId: contentJob.externalPostId,
    externalPostUrl: contentJob.externalPostUrl,
    publishedAt: contentJob.publishedAt?.toISOString() ?? null,
    createdAt: contentJob.createdAt.toISOString(),
    updatedAt: contentJob.updatedAt.toISOString(),
    publications: contentJob.publications.map((publication) => ({
      id: publication.id,
      channel: publication.channel,
      provider: publication.provider,
      status: publication.status,
      externalPostId: publication.externalPostId,
      externalPostUrl: publication.externalPostUrl,
      payloadSummary: publication.payloadSummary,
      errorMessage: publication.errorMessage,
      publishedAt: publication.publishedAt?.toISOString() ?? null,
      createdAt: publication.createdAt.toISOString(),
      updatedAt: publication.updatedAt.toISOString(),
    })),
    assets: contentJob.assets.map((asset) => ({
      id: asset.id,
      channel: asset.channel,
      title: asset.title,
      body: asset.body,
      cta: asset.cta,
      hashtags: asset.hashtags,
      version: asset.version,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      images: asset.imageJobs
        .flatMap((job) => job.imageAssets)
        .map((imageAsset) => ({
          id: imageAsset.id,
          role: imageAsset.role,
          selected: imageAsset.selected,
          width: imageAsset.width,
          height: imageAsset.height,
          url: buildPublicImageAssetUrl(imageAsset.id),
        })),
    })),
  };
}

export async function updateProjectContentAssetDetail(params: {
  projectId: string;
  contentJobId: string;
  assetId: string;
  title?: string;
  body: string;
  cta?: string;
  hashtags?: string;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const updated = await updateContentAssetDraft({
    projectId: params.projectId,
    contentJobId: params.contentJobId,
    assetId: params.assetId,
    title: params.title,
    body: params.body,
    cta: params.cta,
    hashtags: params.hashtags,
  });

  if (!updated) {
    throw new ProjectContentNotFoundError(params.projectId);
  }

  return getProjectContentJobDetail({
    projectId: params.projectId,
    contentJobId: params.contentJobId,
  });
}

export async function selectProjectContentAssetImage(params: {
  projectId: string;
  contentJobId: string;
  assetId: string;
  imageAssetId: string;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const selected = await selectImageAssetForContentAsset({
    contentAssetId: params.assetId,
    imageAssetId: params.imageAssetId,
  });

  if (!selected) {
    throw new ProjectImageNotFoundError(params.projectId);
  }

  return getProjectContentJobDetail({
    projectId: params.projectId,
    contentJobId: params.contentJobId,
  });
}

export async function getProjectAutomationBatchRunHistory(projectId: string, limit?: number) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const runs = await listProjectAutomationBatchRuns(projectId, limit);
  return runs.map((run) => ({
    id: run.id,
    kind: run.kind as AutomationTimelineKind,
    label: run.label,
    actorLabel: run.actorLabel,
    executionSource: run.executionSource,
    durationMs: run.durationMs,
    completed: run.completedCount,
    failed: run.failedCount,
    items: parseAutomationBatchRunItems(run.itemsSnapshot),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }));
}

export async function getProjectAutomationReadiness(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const issues: AutomationReadinessIssue[] = [];
  const automationMode = normalizeAutomationMode(record.project.automationMode);
  const latestPlan = await getLatestProjectContentPlan(projectId);
  const recentPublications = await listProjectChannelPublications(projectId, 20);
  const recentFailedPublications = recentPublications.filter((item) => item.status === "failed");

  if (!record.brandProfile?.approved) {
    issues.push({
      id: "context-approval",
      severity: "blocking",
      area: "context",
      title: "브랜드 컨텍스트 승인이 필요합니다.",
      detail: "자동 생성과 자동 게시 전에 승인된 브랜드 컨텍스트가 있어야 합니다.",
      recommendation: "프로젝트 컨텍스트를 승인 상태로 바꾸세요.",
    });
  }

  if (!record.project.ga4PropertyId) {
    issues.push({
      id: "analytics-missing-property",
      severity: "warning",
      area: "analytics",
      title: "GA4 속성 ID가 없습니다.",
      detail: "월간 계획은 생성되지만 성과 기반 보정 강도가 약해집니다.",
      recommendation: "프로젝트 설정에 GA4 속성 ID를 저장하세요.",
    });
  }

  if (!latestPlan) {
    issues.push({
      id: "plan-missing",
      severity: "warning",
      area: "automation",
      title: "월간 계획이 아직 없습니다.",
      detail: "예약 실행 대상이 없어 자동화가 비어 있을 수 있습니다.",
      recommendation: "월간 계획을 먼저 생성하세요.",
    });
  }

  if (automationMode !== "draft-only") {
    if (!record.project.bloggerBlogId || !record.project.bloggerAccessTokenEncrypted) {
      issues.push({
        id: "blogger-config-missing",
        severity: "blocking",
        area: "automation",
        title: "Blogger 자동 게시 설정이 완전하지 않습니다.",
        detail: "Blog ID와 access token이 모두 필요합니다.",
        recommendation: "채널 설정에서 Blogger 기본값을 저장하세요.",
      });
    }

    if (!process.env.CREDENTIAL_ENCRYPTION_SECRET?.trim()) {
      issues.push({
        id: "vault-secret-missing",
        severity: "blocking",
        area: "automation",
        title: "암호화 시크릿이 없습니다.",
        detail: "저장된 게시 자격증명을 복호화할 수 없습니다.",
        recommendation: "배포 환경에 CREDENTIAL_ENCRYPTION_SECRET을 설정하세요.",
      });
    }
  }

  if (automationMode === "full-auto") {
    const hasMetaAutomation = hasMetaAutomationConfig({
      facebookPageId: record.project.facebookPageId,
      instagramBusinessAccountId: record.project.instagramBusinessAccountId,
      metaAccessTokenEncrypted: record.project.metaAccessTokenEncrypted,
    });

    if (!hasMetaAutomation) {
      issues.push({
        id: "meta-config-missing",
        severity: "warning",
        area: "meta",
        title: "Meta 자동 게시 설정이 비어 있습니다.",
        detail: "지금은 Blogger 자동 게시만 진행하고, 페이스북/인스타그램 자동 게시만 건너뜁니다.",
        recommendation: "소셜 자동 게시가 필요할 때만 Meta 자격증명과 계정 식별자를 저장하세요.",
      });
    }

    if (hasMetaAutomation && !process.env.PUBLIC_APP_URL?.trim()) {
      issues.push({
        id: "public-app-url-missing",
        severity: "blocking",
        area: "images",
        title: "공개 앱 URL이 없습니다.",
        detail: "인스타그램 게시용 이미지 공개 URL을 만들 수 없습니다.",
        recommendation: "배포 환경에 PUBLIC_APP_URL을 설정하세요.",
      });
    }
  }

  if (record.project.metaTokenExpiresAt) {
    const remainingMs = record.project.metaTokenExpiresAt.getTime() - Date.now();

    if (remainingMs <= 0) {
      issues.push({
        id: "meta-token-expired",
        severity: "blocking",
        area: "meta",
        title: "Meta 토큰 만료 예정일이 지났습니다.",
        detail: "저장된 Meta 토큰의 만료 예정일이 현재 시각보다 이전입니다.",
        recommendation: "새 토큰을 저장하고 만료 예정일도 함께 갱신하세요.",
      });
    } else if (remainingMs <= 7 * 24 * 60 * 60 * 1000) {
      issues.push({
        id: "meta-token-expiring-soon",
        severity: "warning",
        area: "meta",
        title: "Meta 토큰 만료 예정일이 7일 이내입니다.",
        detail: `만료 예정 시각: ${record.project.metaTokenExpiresAt.toISOString()}.`,
        recommendation: "운영 중단 전에 토큰을 미리 갱신하세요.",
      });
    }
  }

  if (!record.project.operationsAlertWebhookEncrypted && !process.env.OPERATIONS_ALERT_WEBHOOK_URL?.trim()) {
    issues.push({
      id: "operations-alert-missing",
      severity: "warning",
      area: "operations",
      title: "운영 알림 채널이 없습니다.",
      detail: "실패와 검토 필요 상태가 생겨도 외부 운영 채널로 알릴 수 없습니다.",
      recommendation: "프로젝트 알림 웹훅 또는 OPERATIONS_ALERT_WEBHOOK_URL을 설정하세요.",
    });
  }

  if (!process.env.CRON_SECRET?.trim()) {
    issues.push({
      id: "cron-secret-missing",
      severity: "warning",
      area: "automation",
      title: "CRON_SECRET이 없습니다.",
      detail: "자동 실행 엔드포인트 보호와 예약 실행 운영이 느슨해집니다.",
      recommendation: "배포 환경에 CRON_SECRET을 설정하세요.",
    });
  }

  if (recentFailedPublications.length > 0) {
    const categories = recentFailedPublications
      .map((item) => classifyFailureCategory(item.errorMessage) || "unknown")
      .slice(0, 3)
      .join(", ");

    issues.push({
      id: "recent-publication-failures",
      severity: "warning",
      area: "operations",
      title: "최근 채널 실패 이력이 있습니다.",
      detail: `${recentFailedPublications.length}건의 실패가 남아 있습니다. 주요 유형: ${categories}.`,
      recommendation: "운영 보드에서 실패 이력을 분류별로 정리하고 재시도하세요.",
    });
  }

  if (!process.env.PROJECT_OPERATOR_BOOTSTRAP_SECRET?.trim()) {
    issues.push({
      id: "operator-bootstrap-secret-missing",
      severity: "warning",
      area: "operations",
      title: "운영자 부트스트랩 시크릿이 없습니다.",
      detail: "첫 owner 계정을 안전하게 등록할 부트스트랩 키가 설정되지 않았습니다.",
      recommendation: "배포 환경에 PROJECT_OPERATOR_BOOTSTRAP_SECRET을 설정하세요.",
    });
  }

  const blockingCount = issues.filter((item) => item.severity === "blocking").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const infoCount = issues.filter((item) => item.severity === "info").length;

  return {
    status: blockingCount > 0 ? "blocked" : warningCount > 0 ? "warning" : "ready",
    generatedAt: new Date().toISOString(),
    blockingCount,
    warningCount,
    infoCount,
    issues,
  };
}

export async function recordProjectAutomationBatchRun(params: {
  projectId: string;
  kind: AutomationTimelineKind;
  label: string;
  actorLabel?: string | null;
  executionSource?: string | null;
  durationMs?: number | null;
  completed: number;
  failed: number;
  items: AutomationBatchRunItem[];
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const run = await createAutomationBatchRun({
    projectId: params.projectId,
    kind: params.kind,
    label: params.label,
    actorLabel: params.actorLabel ?? null,
    executionSource: params.executionSource ?? null,
    durationMs: params.durationMs ?? null,
    completedCount: params.completed,
    failedCount: params.failed,
    itemsSnapshot: JSON.stringify(params.items),
  });

  return {
    id: run.id,
    kind: run.kind as AutomationTimelineKind,
    label: run.label,
    actorLabel: run.actorLabel,
    executionSource: run.executionSource,
    durationMs: run.durationMs,
    completed: run.completedCount,
    failed: run.failedCount,
    items: parseAutomationBatchRunItems(run.itemsSnapshot),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export async function retryProjectChannelPublication(params: {
  projectId: string;
  publicationId: string;
}) {
  const publication = await getProjectChannelPublication({
    projectId: params.projectId,
    publicationId: params.publicationId,
  });

  if (!publication) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const project = publication.contentJob.project;
  const contentJob = publication.contentJob;

  if (publication.provider === "meta-instagram") {
    const metaAccessToken = decryptSecret(project.metaAccessTokenEncrypted);
    const instagramAsset = contentJob.assets.find((asset) => asset.channel === "instagram");

    if (!metaAccessToken || !project.instagramBusinessAccountId || !instagramAsset) {
      throw new MetaPublishError("인스타그램 재시도에 필요한 프로젝트 설정 또는 자산이 없습니다.");
    }

    const selectedInstagramImage =
      instagramAsset.imageJobs.flatMap((job) => job.imageAssets).find((image) => image.selected) ||
      instagramAsset.imageJobs.flatMap((job) => job.imageAssets)[0] ||
      null;
    const instagramImageUrl = selectedInstagramImage ? buildPublicImageAssetUrl(selectedInstagramImage.id) : null;

    const instagramPost = await publishToInstagram({
      instagramBusinessAccountId: project.instagramBusinessAccountId,
      accessToken: metaAccessToken,
      imageUrl: instagramImageUrl || "",
      caption: buildChannelMessage({
        title: instagramAsset.title,
        body: instagramAsset.body,
        cta: instagramAsset.cta,
        hashtags: instagramAsset.hashtags,
      }),
    });

    const retried = await createChannelPublication({
      contentJobId: contentJob.id,
      channel: "instagram",
      provider: "meta-instagram",
      status: "published",
      externalPostId: instagramPost.id,
      externalPostUrl: instagramPost.url,
      payloadSummary: instagramAsset.title || instagramAsset.body.slice(0, 140),
      publishedAt: new Date(),
    });

    return {
      id: retried.id,
      channel: retried.channel,
      provider: retried.provider,
      status: retried.status,
      externalPostId: retried.externalPostId,
      externalPostUrl: retried.externalPostUrl,
      payloadSummary: retried.payloadSummary,
      errorMessage: retried.errorMessage,
      publishedAt: retried.publishedAt?.toISOString() ?? null,
      createdAt: retried.createdAt.toISOString(),
      updatedAt: retried.updatedAt.toISOString(),
    };
  }

  if (publication.provider === "meta-facebook") {
    const metaAccessToken = decryptSecret(project.metaAccessTokenEncrypted);
    const facebookAsset = contentJob.assets.find((asset) => asset.channel === "facebook");
    const socialLink = project.domain?.startsWith("http")
      ? project.domain
      : project.domain
        ? `https://${project.domain}`
        : null;

    if (!metaAccessToken || !project.facebookPageId || !facebookAsset) {
      throw new MetaPublishError("페이스북 재시도에 필요한 프로젝트 설정 또는 자산이 없습니다.");
    }

    const facebookPost = await publishToFacebookPage({
      pageId: project.facebookPageId,
      accessToken: metaAccessToken,
      message: buildChannelMessage({
        title: facebookAsset.title,
        body: facebookAsset.body,
        cta: facebookAsset.cta,
        hashtags: facebookAsset.hashtags,
      }),
      link: socialLink,
    });

    const retried = await createChannelPublication({
      contentJobId: contentJob.id,
      channel: "facebook",
      provider: "meta-facebook",
      status: "published",
      externalPostId: facebookPost.id,
      externalPostUrl: facebookPost.url,
      payloadSummary: facebookAsset.title || facebookAsset.body.slice(0, 140),
      publishedAt: new Date(),
    });

    return {
      id: retried.id,
      channel: retried.channel,
      provider: retried.provider,
      status: retried.status,
      externalPostId: retried.externalPostId,
      externalPostUrl: retried.externalPostUrl,
      payloadSummary: retried.payloadSummary,
      errorMessage: retried.errorMessage,
      publishedAt: retried.publishedAt?.toISOString() ?? null,
      createdAt: retried.createdAt.toISOString(),
      updatedAt: retried.updatedAt.toISOString(),
    };
  }

  if (publication.provider === "blogger") {
    const blogAsset = contentJob.assets.find((asset) => asset.channel === "blog");
    const storedAccessToken = decryptSecret(project.bloggerAccessTokenEncrypted);

    if (!project.bloggerBlogId || !storedAccessToken || !blogAsset) {
      throw new BloggerPublishError("Blogger 재시도에 필요한 프로젝트 설정 또는 블로그 자산이 없습니다.");
    }

    const approvedRecord = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);
    const publishPackage = buildBlogPublishPackage({
      project,
      profile: approvedRecord.brandProfile,
      asset: blogAsset,
      fallbackTitle: contentJob.topic || `${project.name} 블로그 초안`,
      contentJobId: contentJob.id,
      status: contentJob.status,
      updatedAt: contentJob.updatedAt.toISOString(),
    });

    const bloggerPost = await publishToBlogger({
      blogId: project.bloggerBlogId,
      accessToken: storedAccessToken,
      status: project.bloggerStatus === "publish" ? "publish" : "draft",
      title: publishPackage.title,
      content: publishPackage.bodyHtml,
      labels:
        blogAsset.hashtags
          ?.split(",")
          .map((tag) => tag.trim().replace(/^#/, ""))
          .filter(Boolean) || [],
    });

    await saveLatestContentJobPublishResult({
      projectId: params.projectId,
      status: project.bloggerStatus === "publish" ? "published" : "ready_to_publish",
      publishProvider: "blogger",
      externalPostId: bloggerPost.postId,
      externalPostUrl: bloggerPost.url || bloggerPost.selfLink || null,
      publishedAt: new Date(),
    });

    const retried = await createChannelPublication({
      contentJobId: contentJob.id,
      channel: "blog",
      provider: "blogger",
      status: project.bloggerStatus === "publish" ? "published" : "ready_to_publish",
      externalPostId: bloggerPost.postId,
      externalPostUrl: bloggerPost.url || bloggerPost.selfLink || null,
      payloadSummary: publishPackage.title || blogAsset.body.slice(0, 140),
      publishedAt: new Date(),
    });

    return {
      id: retried.id,
      channel: retried.channel,
      provider: retried.provider,
      status: retried.status,
      externalPostId: retried.externalPostId,
      externalPostUrl: retried.externalPostUrl,
      payloadSummary: retried.payloadSummary,
      errorMessage: retried.errorMessage,
      publishedAt: retried.publishedAt?.toISOString() ?? null,
      createdAt: retried.createdAt.toISOString(),
      updatedAt: retried.updatedAt.toISOString(),
    };
  }

  throw new Error(`지원하지 않는 채널 재시도 provider입니다: ${publication.provider}`);
}

export async function generateProjectMonthlyPlan(projectId: string, monthKey?: string) {
  const record = requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
  const contentJobs = await listProjectContentJobs(projectId);
  const snapshot = await getAnalyticsSnapshot("90d", record.project.ga4PropertyId ?? undefined);
  const allPublications = contentJobs.flatMap((job) => job.publications ?? []);
  const successfulPublications = allPublications.filter((publication) => publication.status === "published");
  const failedPublications = allPublications.filter((publication) => publication.status === "failed");
  const channelMix = successfulPublications.reduce<Record<string, number>>((accumulator, publication) => {
    accumulator[publication.channel] = (accumulator[publication.channel] || 0) + 1;
    return accumulator;
  }, {});
  const generated = buildMonthlyContentPlan({
    project: {
      id: record.project.id,
      name: record.project.name,
      domain: record.project.domain,
      industry: record.project.industry,
      ga4PropertyId: record.project.ga4PropertyId,
    },
    approvedProfile: {
      summary: record.brandProfile.summary,
      audience: record.brandProfile.audience,
      tone: record.brandProfile.tone,
      cta: record.brandProfile.cta,
      bannedTerms: record.brandProfile.bannedTerms,
    },
    topics: record.topics.map((topic) => ({
      title: normalizeTopicTitle(topic.title, record.project.name),
      intentType: topic.intentType,
      score: topic.score,
      rationale: topic.rationale,
    })),
    snapshot,
    performanceFeedback: {
      publishedJobs: contentJobs.filter((job) => Boolean(job.publishedAt)).length,
      failedPublications: failedPublications.length,
      successfulPublications: successfulPublications.length,
      channelMix: Object.entries(channelMix)
        .map(([channel, count]) => ({ channel, count }))
        .sort((left, right) => right.count - left.count),
      recentPublishedTopics: contentJobs
        .filter((job) => Boolean(job.publishedAt))
        .slice(0, 3)
        .map((job) => job.topic),
    },
    monthKey,
  });

  const saved = await saveProjectContentPlan({
    projectId,
    monthKey: generated.monthKey,
    status: generated.status,
    basisSummary: generated.basisSummary,
    autoGenerate: generated.autoGenerate,
    generatedAt: generated.generatedAt,
    items: generated.items,
  });

  return serializeContentPlan(saved);
}

export async function executeDueContentPlanItems(referenceTime = new Date(), projectId?: string) {
  const dueItems = await listDueContentPlanItems(referenceTime, projectId);
  const results: Array<{
    planItemId: string;
    projectId: string;
    status: AutomationExecutionStatus;
    contentJobId?: string | null;
    message: string;
  }> = [];

  for (const item of dueItems) {
    try {
      results.push(await processAutomationPlanItem(item));
    } catch (error) {
      const projectId = item.contentPlan.projectId;
      const message = error instanceof Error ? error.message : "자동 실행에 실패했습니다.";
      logger.error("content_plan.execute.failed", {
        projectId,
        planItemId: item.id,
        error: message,
      });

      await markContentPlanItemStatus({
        planItemId: item.id,
        status: "failed",
        lastError: message.slice(0, 4000),
        reviewSnapshot: null,
      });

      results.push({
        planItemId: item.id,
        projectId,
        status: "failed",
        message,
      });
    }
  }

  return {
    executedAt: referenceTime.toISOString(),
    total: dueItems.length,
    published: results.filter((item) => item.status === "published").length,
    readyToPublish: results.filter((item) => item.status === "ready_to_publish").length,
    needsReview: results.filter((item) => item.status === "needs_review").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  };
}

export async function executeProjectAutomation(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const readiness = await getProjectAutomationReadiness(projectId);

  if (readiness.status === "blocked") {
    const firstBlockingIssue = readiness.issues.find((issue) => issue.severity === "blocking");
    throw new ProjectAutomationReadinessError(
      firstBlockingIssue?.detail || "자동화 준비도 차단 이슈가 있어 프로젝트 자동 실행을 중단했습니다.",
    );
  }

  return executeDueContentPlanItems(new Date(), projectId);
}

export async function resolveProjectAutomationReview(params: {
  projectId: string;
  planItemId: string;
  action: "approve" | "retry";
}) {
  const item = await getProjectContentPlanItem({
    projectId: params.projectId,
    planItemId: params.planItemId,
  });

  if (!item) {
    throw new ProjectPlanItemNotFoundError(params.planItemId);
  }

  if (params.action === "retry") {
    const run = await processAutomationPlanItem(item);
    return {
      action: "retry" as const,
      ...run,
    };
  }

  const record = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);
  const latestContentJob = record.latestContentJob;

  if (!latestContentJob) {
    throw new ProjectContentNotFoundError(params.projectId);
  }

  const storedBloggerAccessToken = decryptSecret(record.project.bloggerAccessTokenEncrypted);
  const hasBloggerAutomation =
    Boolean(record.project.bloggerBlogId) &&
    Boolean(storedBloggerAccessToken);
  const automationMode = normalizeAutomationMode(record.project.automationMode);

  const publish = await markProjectReadyForPublish(
    params.projectId,
    hasBloggerAutomation
      ? {
          blogger: {
            blogId: record.project.bloggerBlogId || "",
            accessToken: storedBloggerAccessToken || "",
            status: record.project.bloggerStatus === "publish" ? "publish" : "draft",
          },
        }
      : undefined,
    { skipSafetyGate: true },
  );

  const metaAccessToken = decryptSecret(record.project.metaAccessTokenEncrypted);
  const hasMetaAutomation = hasMetaAutomationConfig({
    facebookPageId: record.project.facebookPageId,
    instagramBusinessAccountId: record.project.instagramBusinessAccountId,
    metaAccessToken,
  });

  if (automationMode === "full-auto" && hasMetaAutomation) {
    await publishProjectSocialChannels({
      project: record.project,
      latestContentJob,
      metaAccessToken,
    });
  }

  await markContentPlanItemStatus({
    planItemId: item.id,
    status: publish.status === "published" ? "published" : "ready_to_publish",
    contentJobId: publish.contentJobId,
    generatedAt: new Date(),
    lastError: null,
    reviewSnapshot: null,
  });

  return {
    action: "approve" as const,
    planItemId: item.id,
    projectId: params.projectId,
    status: (publish.status === "published" ? "published" : "ready_to_publish") as AutomationExecutionStatus,
    contentJobId: publish.contentJobId,
    message:
      publish.status === "published"
        ? `${item.topic} 항목을 승인해 자동 게시를 재개했습니다.`
        : `${item.topic} 항목을 승인해 발행 준비 상태로 전환했습니다.`,
  };
}

export async function getProjectStudioSeed(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record || !record.brandProfile) {
    logger.error("project.studio.not_found", { projectId });
    throw new ProjectNotFoundError(projectId);
  }

  const persistedAssets = record.latestContentJob?.assets ?? [];
  const seed = buildStudioSeed({
    projectName: record.project.name,
    industry: record.project.industry,
    profile: record.brandProfile,
    topics: record.topics,
  });
  const normalizedLatestTopic = normalizeTopicTitle(record.latestContentJob?.topic ?? seed.topic, record.project.name);
  const persistedAssetPayload = persistedAssets.map((asset) => ({
    channel: asset.channel as "blog" | "instagram" | "facebook",
    title: asset.title ?? "",
    body: asset.body,
    cta: asset.cta ?? "",
    hashtags: asset.hashtags ?? "",
  }));
  const usePersistedAssets =
    persistedAssetPayload.length > 0 &&
    !isLegacyContentShape({
      topic: record.latestContentJob?.topic ?? "",
      assets: persistedAssetPayload,
    });
  const generationProvider: ContentGenerationProvider =
    usePersistedAssets && record.latestContentJob?.generationProvider === "openai" ? "openai" : "fallback";
  const assets = usePersistedAssets
    ? persistedAssetPayload
    : buildStudioSeed({
        projectName: record.project.name,
        industry: record.project.industry,
        profile: record.brandProfile,
        topics: [{ title: normalizedLatestTopic, score: 10 }],
      }).assets;
  const review = buildReviewSummary({
    summary: record.brandProfile.summary,
    cta: record.brandProfile.cta,
    bannedTerms: record.brandProfile.bannedTerms,
    assets,
  });
  const assetImages =
    record.latestContentJob?.assets.map((asset) => ({
      channel: asset.channel as "blog" | "instagram" | "facebook",
      prompt: asset.imageJobs[0]?.prompt ?? null,
      variants: asset.imageJobs.flatMap((job) =>
        job.imageAssets.map((imageAsset) => ({
          id: imageAsset.id,
          role: imageAsset.role,
          url: imageAsset.composedPath || imageAsset.originalPath || "",
          width: imageAsset.width,
          height: imageAsset.height,
          selected: imageAsset.selected,
        })),
      ),
    })) ?? [];

  return {
    project: {
      id: record.project.id,
      name: record.project.name,
      domain: record.project.domain,
      industry: record.project.industry,
      workingPath: record.project.workingPath,
      status: record.project.status,
    },
    brandProfile: {
      id: record.brandProfile.id,
      summary: record.brandProfile.summary,
      audience: record.brandProfile.audience,
      tone: record.brandProfile.tone,
      cta: record.brandProfile.cta,
      bannedTerms: record.brandProfile.bannedTerms,
      approved: record.brandProfile.approved,
    },
    topics: record.topics.map((topic) => ({
      id: topic.id,
      title: normalizeTopicTitle(topic.title, record.project.name),
      intentType: topic.intentType,
      score: topic.score,
    })),
    draft: {
      topic: normalizedLatestTopic,
      objective:
        usePersistedAssets && record.latestContentJob?.objective
          ? record.latestContentJob.objective
          : seed.objective,
      generationProvider,
      assets,
      images: assetImages,
    },
    review,
    analysisMode: "client-source-metadata-and-excerpt",
  };
}

export async function previewProjectContext(input: CreateProjectInput) {
  const enrichedInput = await enrichInputWithWebsiteSource(input);
  const sourceAnalysis = analyzeSourceFiles(enrichedInput.sourceFiles);
  const contextDraft = buildContextDraft(enrichedInput, sourceAnalysis);
  const topics = buildTopicRecommendations({
    projectName: enrichedInput.name,
    domain: enrichedInput.domain,
    contextDraft,
    sourceAnalysis,
  });

  return {
    contextDraft,
    topics,
    sourceAnalysis,
  };
}

async function enrichInputWithWebsiteSource(input: CreateProjectInput): Promise<CreateProjectInput> {
  const websiteSource = await fetchWebsiteSource(input.domain);

  if (!websiteSource) {
    logger.info("project.website_source.unavailable", {
      domain: input.domain,
      sourceFileCount: input.sourceFiles.length,
    });
    return input;
  }

  logger.info("project.website_source.fetched", {
    domain: input.domain,
    fetchedPath: websiteSource.relativePath,
  });

  return {
    ...input,
    sourceFiles: [websiteSource, ...input.sourceFiles].slice(0, 50),
  };
}

export async function approveProjectContext(params: {
  projectId: string;
  summary: string;
  audience?: string;
  tone?: string;
  cta?: string;
  bannedTerms?: string;
}) {
  await approveBrandProfileVersion(params);
  return getProjectById(params.projectId);
}

export async function saveProjectContextDraft(params: {
  projectId: string;
  summary: string;
  audience?: string;
  tone?: string;
  cta?: string;
  bannedTerms?: string;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  await saveBrandProfileDraft(params);
  return getProjectById(params.projectId);
}

export async function regenerateProjectContextDraft(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const baseInput: CreateProjectInput = {
    name: record.project.name,
    domain: record.project.domain ?? undefined,
    industry: record.project.industry ?? undefined,
    workingPath: record.project.workingPath ?? undefined,
    sourceFiles: [],
  };

  const enrichedInput = await enrichInputWithWebsiteSource(baseInput);
  const sourceAnalysis = analyzeSourceFiles(enrichedInput.sourceFiles);
  const contextDraft = buildContextDraft(enrichedInput, sourceAnalysis);
  const topics = buildTopicRecommendations({
    projectName: enrichedInput.name,
    domain: enrichedInput.domain,
    contextDraft,
    sourceAnalysis,
  });

  await saveBrandProfileDraft({
    projectId,
    summary: contextDraft.summary,
    audience: contextDraft.audience,
    tone: contextDraft.tone,
    cta: contextDraft.cta,
    bannedTerms: contextDraft.bannedTerms,
  });

  await replaceProjectTopics({
    projectId,
    topics,
  });

  return getProjectById(projectId);
}

export async function generateProjectContent(params: {
  projectId: string;
  topic?: string;
  topicId?: string;
  planItemId?: string;
  objective?: string;
  derivationMode?: "blog-first" | "independent";
}) {
  const record = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);

  const selectedTopic =
    (params.topicId
      ? record.topics.find((topic) => topic.id === params.topicId)?.title
      : undefined) ||
    params.topic ||
    record.topics[0]?.title;

  if (!selectedTopic) {
    throw new Error("콘텐츠 생성에 사용할 주제가 없습니다.");
  }

  const normalizedTopic = normalizeTopicTitle(selectedTopic, record.project.name);

  if (params.derivationMode === "blog-first") {
    const blogGenerated = await buildGeneratedStudioSeed({
      projectName: record.project.name,
      industry: record.project.industry,
      profile: record.brandProfile,
      topics: [{ title: normalizedTopic, score: 10 }],
    });
    const blogAsset = blogGenerated.seed.assets.find((a) => a.channel === "blog")!;

    const derived = await buildDerivedChannelAssets({
      blogAsset: {
        title: blogAsset.title,
        body: blogAsset.body,
        cta: blogAsset.cta,
        hashtags: blogAsset.hashtags,
      },
      projectName: record.project.name,
      industry: record.project.industry,
      profile: record.brandProfile,
    });

    const combinedAssets = [blogAsset, ...derived.assets];

    const job = await createOrUpdateContentJobWithAssets({
      projectId: params.projectId,
      topic: normalizedTopic,
      objective: params.objective || blogGenerated.seed.objective,
      generationProvider: blogGenerated.provider,
      assets: combinedAssets,
    });

    if (params.planItemId) {
      await attachContentJobToPlanItem({
        projectId: params.projectId,
        planItemId: params.planItemId,
        contentJobId: job.id,
        status: "generated",
        generatedAt: new Date(),
      });
    }

    return getProjectStudioSeed(params.projectId);
  }

  const generated = await buildGeneratedStudioSeed({
    projectName: record.project.name,
    industry: record.project.industry,
    profile: record.brandProfile,
    topics: [{ title: normalizedTopic, score: 10 }],
  });
  const seed = generated.seed;

  const job = await createOrUpdateContentJobWithAssets({
    projectId: params.projectId,
    topic: normalizedTopic,
    objective: params.objective || seed.objective,
    generationProvider: generated.provider,
    assets: seed.assets,
  });

  if (params.planItemId) {
    await attachContentJobToPlanItem({
      projectId: params.projectId,
      planItemId: params.planItemId,
      contentJobId: job.id,
      status: "generated",
      generatedAt: new Date(),
    });
  }

  return getProjectStudioSeed(params.projectId);
}

export async function saveProjectContentDraft(params: {
  projectId: string;
  topic: string;
  objective?: string;
  assets: Array<{
    channel: "blog" | "instagram" | "facebook";
    title?: string;
    body: string;
    cta?: string;
    hashtags?: string;
  }>;
}) {
  const record = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);
  const automationMode = normalizeAutomationMode(record.project.automationMode);
  const storedBloggerAccessToken = decryptSecret(record.project.bloggerAccessTokenEncrypted);

  const normalizedTopic = normalizeTopicTitle(params.topic, record.project.name);

  await saveLatestContentJobAssets({
    projectId: params.projectId,
    topic: normalizedTopic,
    objective: params.objective,
    assets: params.assets,
  });

  const refreshedRecord = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);
  const latestContentJob = refreshedRecord.latestContentJob;
  const review = buildReviewSummary({
    summary: refreshedRecord.brandProfile.summary,
    cta: refreshedRecord.brandProfile.cta,
    bannedTerms: refreshedRecord.brandProfile.bannedTerms,
    assets: params.assets,
  });
  const guardrail = evaluateReviewGuardrail({
    requireReview: refreshedRecord.project.automationRequireReview,
    minOverallScore: refreshedRecord.project.automationMinOverallScore,
    minRiskScore: refreshedRecord.project.automationMinRiskScore,
    review,
  });
  const reviewSnapshot = buildReviewSnapshot({
    guardrail,
    review,
    requireReview: refreshedRecord.project.automationRequireReview,
    minOverallScore: refreshedRecord.project.automationMinOverallScore,
    minRiskScore: refreshedRecord.project.automationMinRiskScore,
  });
  const nextStatus = guardrail.approved ? "ready_to_publish" : "needs_review";
  let finalStatus = nextStatus;

  await updateLatestContentJobStatus(params.projectId, nextStatus);

  const shouldAutoPublishEditedDraft =
    automationMode !== "draft-only" &&
    guardrail.approved &&
    Boolean(refreshedRecord.project.bloggerBlogId) &&
    Boolean(storedBloggerAccessToken) &&
    Boolean(latestContentJob);

  if (shouldAutoPublishEditedDraft) {
    const publish = await markProjectReadyForPublish(params.projectId, {
      blogger: {
        blogId: refreshedRecord.project.bloggerBlogId || "",
        accessToken: storedBloggerAccessToken || "",
        status: refreshedRecord.project.bloggerStatus === "publish" ? "publish" : "draft",
      },
    });

    finalStatus = publish.status === "published" ? "published" : "ready_to_publish";

    if (automationMode === "full-auto") {
      const latestPublishedRecord = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);
      const latestPublishedContentJob = latestPublishedRecord.latestContentJob;
      const metaAccessToken = decryptSecret(latestPublishedRecord.project.metaAccessTokenEncrypted);
      const hasMetaAutomation = hasMetaAutomationConfig({
        facebookPageId: latestPublishedRecord.project.facebookPageId,
        instagramBusinessAccountId: latestPublishedRecord.project.instagramBusinessAccountId,
        metaAccessToken,
      });

      if (latestPublishedContentJob && hasMetaAutomation) {
        await publishProjectSocialChannels({
          project: latestPublishedRecord.project,
          latestContentJob: latestPublishedContentJob,
          metaAccessToken,
        });
      }
    }
  }

  if (latestContentJob?.id) {
    const linkedPlanItem = await getProjectContentPlanItemByContentJobId({
      projectId: params.projectId,
      contentJobId: latestContentJob.id,
    });

    if (linkedPlanItem) {
      await updateContentPlanItemReviewState({
        planItemId: linkedPlanItem.id,
        status: finalStatus,
        lastError: guardrail.approved ? null : guardrail.message,
        reviewSnapshot,
      });
    }
  }

  return getProjectStudioSeed(params.projectId);
}

export async function getProjectActivity(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const [brandProfiles, contentJobs] = await Promise.all([
    listProjectBrandProfiles(projectId),
    listProjectContentJobs(projectId),
  ]);

  const brandEvents = brandProfiles.map((profile) => ({
    id: `brand-${profile.id}`,
    kind: profile.approved ? "brand-approved" : "brand-draft",
    title: profile.approved ? `컨텍스트 승인 v${profile.version}` : `컨텍스트 임시 저장 v${profile.version}`,
    description: profile.summary.slice(0, 160),
    timestamp: profile.updatedAt.toISOString(),
  }));

  const contentEvents = contentJobs.map((job) => ({
    id: `content-${job.id}`,
    kind: job.publishProvider && job.externalPostUrl ? "publish-ready" : job.status === "ready_to_publish" ? "publish-ready" : "content-saved",
    title:
      job.publishProvider && job.externalPostUrl
        ? `${job.topic} ${job.publishProvider} 게시 완료`
        : job.status === "ready_to_publish"
          ? `${job.topic} 발행 준비 완료`
        : `${job.topic} 콘텐츠 저장`,
    description:
      job.publishProvider && job.externalPostUrl
        ? `${job.assets.length}개 채널 초안 · 상태 ${job.status} · ${job.externalPostUrl}`
        : `${job.assets.length}개 채널 초안 · 상태 ${job.status}`,
    timestamp: (job.publishedAt ?? job.updatedAt).toISOString(),
  }));

  return [...brandEvents, ...contentEvents].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export async function exportProjectContent(projectId: string) {
  requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
  const studio = await getProjectStudioSeed(projectId);

  if (!studio.draft.assets.length) {
    throw new ProjectContentNotFoundError(projectId);
  }

  const slug = createExportSlug(studio.project.name);
  const channels = studio.draft.assets.map((asset) => ({
    channel: asset.channel,
    filename: asset.channel === "blog" ? `${slug}-blog.html` : `${slug}-${asset.channel}.txt`,
    hashtagsFilename: asset.channel === "blog" ? undefined : `${slug}-${asset.channel}-hashtags.txt`,
    title: asset.title,
    content:
      asset.channel === "blog"
        ? buildBlogHtml({
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
            hashtags: asset.hashtags,
          })
        : [asset.title, "", asset.body, "", "CTA", asset.cta].filter(Boolean).join("\n"),
    hashtags: asset.channel === "blog" ? "" : asset.hashtags || "",
  }));

  return {
    generatedAt: new Date().toISOString(),
    jsonFilename: `${slug}-export.json`,
    channels,
  };
}

export async function markProjectReadyForPublish(
  projectId: string,
  options?: {
    blogger?: {
      blogId: string;
      accessToken: string;
      status: "draft" | "publish";
    };
    publishOverrides?: {
      title?: string;
      slug?: string;
      summary?: string;
      bodyHtml?: string;
    };
  },
  settings?: {
    skipSafetyGate?: boolean;
  },
) {
  let record = requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
  let latestContentJob = record.latestContentJob;
  const storedBloggerAccessToken = decryptSecret(record.project.bloggerAccessTokenEncrypted);

  if (!latestContentJob) {
    throw new ProjectContentNotFoundError(projectId);
  }

  let blogAsset = latestContentJob.assets.find((asset) => asset.channel === "blog");

  if (!blogAsset) {
    throw new ProjectContentNotFoundError(projectId);
  }

  const hasInlineImageCue = /\[이미지\s+\d+\]/.test(blogAsset.body);
  const hasBlogImages = blogAsset.imageJobs.some((job) =>
    job.imageAssets.some((imageAsset) => Boolean(imageAsset.composedPath || imageAsset.originalPath)),
  );

  if (hasInlineImageCue && !hasBlogImages) {
    const bundle = await buildImageVariants(record.project.name, {
      channel: "blog",
      title: blogAsset.title || latestContentJob.topic,
      body: blogAsset.body,
      cta: blogAsset.cta || record.brandProfile.cta || "자세히 보기",
    });

    await createImageJobWithAssets({
      contentAssetId: blogAsset.id,
      channelPreset: `blog-${bundle.preset.width}x${bundle.preset.height}`,
      prompt: bundle.prompt,
      imageAssets: bundle.images,
    });

    record = requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
    latestContentJob = record.latestContentJob;
    blogAsset = latestContentJob?.assets.find((asset) => asset.channel === "blog");

    if (!latestContentJob || !blogAsset) {
      throw new ProjectContentNotFoundError(projectId);
    }
  }

  const effectiveBlogger =
    options?.blogger && (options.blogger.blogId || record.project.bloggerBlogId)
      ? {
          blogId: options.blogger.blogId || record.project.bloggerBlogId || "",
          accessToken: options.blogger.accessToken || storedBloggerAccessToken || "",
          status: options.blogger.status,
        }
      : null;

  if (effectiveBlogger && !settings?.skipSafetyGate) {
    const review = buildReviewSummary({
      summary: record.brandProfile.summary,
      cta: record.brandProfile.cta,
      bannedTerms: record.brandProfile.bannedTerms,
      assets: latestContentJob.assets.map((asset) => ({
        channel: asset.channel,
        title: asset.title,
        body: asset.body,
        cta: asset.cta,
        hashtags: asset.hashtags,
      })),
    });
    const guardrail = evaluateReviewGuardrail({
      requireReview: record.project.automationRequireReview,
      minOverallScore: record.project.automationMinOverallScore,
      minRiskScore: record.project.automationMinRiskScore,
      review,
    });

    if (!guardrail.approved) {
      await updateLatestContentJobStatus(projectId, "needs_review");
      throw new ProjectPublishSafetyError(guardrail.message || "리뷰 가드레일에 의해 게시가 차단되었습니다.");
    }
  }

  const publishPackage = buildBlogPublishPackage({
    project: record.project,
    profile: record.brandProfile,
    asset: blogAsset,
    fallbackTitle: latestContentJob.topic || `${record.project.name} 블로그 초안`,
    contentJobId: latestContentJob.id,
    status: latestContentJob.status,
    updatedAt: latestContentJob.updatedAt.toISOString(),
    overrides: options?.publishOverrides,
  });
  let publishResult:
    | { provider: "blogger"; status: "draft" | "publish"; postId: string; link: string }
    | null = null;
  let blogger = null as Awaited<ReturnType<typeof publishToBlogger>> | null;

  if (effectiveBlogger && effectiveBlogger.blogId && effectiveBlogger.accessToken) {
    try {
      blogger = await publishToBlogger({
        blogId: effectiveBlogger.blogId,
        accessToken: effectiveBlogger.accessToken,
        status: effectiveBlogger.status,
        postId: latestContentJob.externalPostId,
        title: publishPackage.title,
        content: publishPackage.bodyHtml,
        labels:
          blogAsset.hashtags
            ?.split(",")
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean) || [],
      });

      await createChannelPublication({
        contentJobId: latestContentJob.id,
        channel: "blog",
        provider: "blogger",
        status: effectiveBlogger.status === "publish" ? "published" : "ready_to_publish",
        externalPostId: blogger.postId,
        externalPostUrl: blogger.url || blogger.selfLink || null,
        payloadSummary: publishPackage.title || blogAsset.body.slice(0, 140),
        publishedAt: new Date(),
      });
      publishResult = {
        provider: "blogger",
        status: effectiveBlogger.status,
        postId: blogger.postId,
        link: blogger.url || blogger.selfLink || "",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blogger 게시에 실패했습니다.";

      await createChannelPublication({
        contentJobId: latestContentJob.id,
        channel: "blog",
        provider: "blogger",
        status: "failed",
        errorMessage: message.slice(0, 4000),
        payloadSummary: publishPackage.title || blogAsset.body.slice(0, 140),
      });

      throw error;
    }
  }

  const updated = publishResult
    ? await saveLatestContentJobPublishResult({
        projectId,
        status: publishResult.status === "publish" ? "published" : "ready_to_publish",
        publishProvider: publishResult.provider,
        externalPostId: publishResult.postId,
        externalPostUrl: publishResult.link,
        publishedAt: new Date(),
      })
    : await saveLatestContentJobPublishResult({
        projectId,
        status: "ready_to_publish",
        publishProvider: null,
        externalPostId: null,
        externalPostUrl: null,
        publishedAt: null,
      });

  if (!updated) {
    throw new ProjectContentNotFoundError(projectId);
  }

  return {
    projectId,
    contentJobId: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
    publishPackage: {
      ...publishPackage,
      contentJobId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    },
    blogger,
  };
}

export async function generateProjectImages(params: {
  projectId: string;
  channel: "blog" | "instagram" | "facebook";
  prompt?: string;
}) {
  const record = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);

  if (!record.latestContentJob) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const asset = record.latestContentJob.assets.find((item) => item.channel === params.channel);

  if (!asset) {
    throw new ProjectImageNotFoundError(params.projectId);
  }

  const bundle = await buildImageVariants(record.project.name, {
    channel: params.channel,
    title: asset.title || record.latestContentJob.topic,
    body: asset.body,
    cta: asset.cta || record.brandProfile.cta || "자세히 보기",
  }, params.prompt);

  await createImageJobWithAssets({
    contentAssetId: asset.id,
    channelPreset: `${params.channel}-${bundle.preset.width}x${bundle.preset.height}`,
    prompt: bundle.prompt,
    imageAssets: bundle.images,
  });

  return getProjectStudioSeed(params.projectId);
}

export async function selectProjectImage(params: {
  projectId: string;
  channel: "blog" | "instagram" | "facebook";
  imageAssetId: string;
}) {
  const record = requireApprovedBrandProfile(await getProjectDetail(params.projectId), params.projectId);

  if (!record.latestContentJob) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const asset = record.latestContentJob.assets.find((item) => item.channel === params.channel);

  if (!asset) {
    throw new ProjectImageNotFoundError(params.projectId);
  }

  const selected = await selectImageAssetForContentAsset({
    contentAssetId: asset.id,
    imageAssetId: params.imageAssetId,
  });

  if (!selected) {
    throw new ProjectImageNotFoundError(params.projectId);
  }

  return getProjectStudioSeed(params.projectId);
}

export async function generateProjectContentVariants(
  projectId: string,
  topic?: string,
  count?: number,
) {
  const record = requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);

  const selectedTopic = topic || record.topics[0]?.title;

  if (!selectedTopic) {
    throw new Error("배리언트 생성에 사용할 주제가 없습니다.");
  }

  const normalizedTopic = normalizeTopicTitle(selectedTopic, record.project.name);
  const variantGroupId = crypto.randomUUID();
  const variantCount = Math.max(2, Math.min(3, count ?? 3));
  const angles: VariantAngle[] = ["practical", "data", "qa"];
  const selectedAngles = angles.slice(0, variantCount);

  const variantJobs = await Promise.all(
    selectedAngles.map(async (angle) => {
      const result = await buildVariantStudioSeed({
        projectName: record.project.name,
        industry: record.project.industry,
        profile: record.brandProfile,
        topics: [{ title: normalizedTopic, score: 10 }],
        angle,
      });

      const created = await createContentJobVariant({
        projectId,
        topic: normalizedTopic,
        objective: result.seed.objective,
        generationProvider: result.provider,
        variantGroupId,
        variantLabel: result.variantLabel,
        assets: result.seed.assets,
      });

      return created;
    }),
  );

  logger.info("project.variants.generated", {
    projectId,
    variantGroupId,
    variantCount: variantJobs.length,
  });

  const group = await getVariantGroup(projectId, variantGroupId);
  return {
    groupId: variantGroupId,
    variants: group,
  };
}

export async function getProjectVariantGroup(projectId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const group = await getLatestVariantGroup(projectId);
  return group;
}

export async function adoptProjectVariant(projectId: string, contentJobId: string) {
  const record = await getProjectDetail(projectId);

  if (!record) {
    throw new ProjectNotFoundError(projectId);
  }

  const adopted = await adoptVariant(contentJobId);

  if (!adopted) {
    throw new ProjectContentNotFoundError(projectId);
  }

  logger.info("project.variant.adopted", {
    projectId,
    contentJobId,
  });

  return getProjectById(projectId);
}
