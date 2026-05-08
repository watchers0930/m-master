import { logger } from "../logger";
import {
  approveBrandProfileVersion,
  createImageJobWithAssets,
  createOrUpdateContentJobWithAssets,
  createProjectWithSeeds,
  deleteProjectById,
  getProjectDetail,
  listProjectBrandProfiles,
  listProjectContentJobs,
  listProjects,
  replaceProjectTopics,
  saveBrandProfileDraft,
  saveLatestContentJobPublishResult,
  saveLatestContentJobAssets,
  selectImageAssetForContentAsset,
  updateProjectSettings,
  updateLatestContentJobStatus,
} from "../repositories/project-repository";
import { buildContextDraft } from "./context-draft-service";
import { buildGeneratedStudioSeed, type ContentGenerationProvider } from "./content-generation-service";
import { buildImageVariants } from "./image-studio-service";
import { buildBlogHtml, buildBlogPublishPackage, createExportSlug } from "./blog-publish-service";
import { buildReviewSummary } from "./review-service";
import { analyzeSourceFiles } from "./source-analysis-service";
import { buildStudioSeed } from "./studio-seed-service";
import { buildTopicRecommendations, normalizeTopicTitle } from "./topic-recommendation-service";
import { fetchWebsiteSource } from "./website-source-service";
import { publishToWordPress, WordPressPublishError } from "./wordpress-publish-service";
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

export { WordPressPublishError };

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

function serializeProjectListItem(item: Awaited<ReturnType<typeof listProjects>>[number]) {
  const latestProfile = item.brandProfiles[0] ?? null;

  return {
    id: item.id,
    name: item.name,
    domain: item.domain,
    industry: item.industry,
    workingPath: item.workingPath,
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
    topTopics: item.topics.slice(0, 3).map((topic) => ({
      id: topic.id,
      title: normalizeTopicTitle(topic.title, item.name),
      intentType: topic.intentType,
      score: topic.score,
    })),
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
      status: record.project.status,
      wordpressSiteUrl: record.project.wordpressSiteUrl,
      wordpressUsername: record.project.wordpressUsername,
      wordpressStatus: record.project.wordpressStatus,
      wordpressCategoryNames: record.project.wordpressCategoryNames,
      wordpressTagNames: record.project.wordpressTagNames,
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

export async function createProject(input: CreateProjectInput) {
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
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressStatus?: "draft" | "publish";
  wordpressCategoryNames?: string;
  wordpressTagNames?: string;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new ProjectNotFoundError(params.projectId);
  }

  await updateProjectSettings({
    projectId: params.projectId,
    industry: params.industry,
    wordpressSiteUrl: params.wordpressSiteUrl,
    wordpressUsername: params.wordpressUsername,
    wordpressStatus: params.wordpressStatus,
    wordpressCategoryNames: params.wordpressCategoryNames,
    wordpressTagNames: params.wordpressTagNames,
  });

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
  objective?: string;
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
  const generated = await buildGeneratedStudioSeed({
    projectName: record.project.name,
    industry: record.project.industry,
    profile: record.brandProfile,
    topics: [{ title: normalizedTopic, score: 10 }],
  });
  const seed = generated.seed;

  await createOrUpdateContentJobWithAssets({
    projectId: params.projectId,
    topic: normalizedTopic,
    objective: params.objective || seed.objective,
    generationProvider: generated.provider,
    assets: seed.assets,
  });

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

  const normalizedTopic = normalizeTopicTitle(params.topic, record.project.name);

  await saveLatestContentJobAssets({
    projectId: params.projectId,
    topic: normalizedTopic,
    objective: params.objective,
    assets: params.assets,
  });

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
    wordpress?: {
      siteUrl: string;
      username: string;
      appPassword: string;
      status: "draft" | "publish";
      categoryNames?: string;
      tagNames?: string;
    };
    publishOverrides?: {
      title?: string;
      slug?: string;
      summary?: string;
      bodyHtml?: string;
    };
  },
) {
  const record = requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
  const latestContentJob = record.latestContentJob;

  if (!latestContentJob) {
    throw new ProjectContentNotFoundError(projectId);
  }

  const blogAsset = latestContentJob.assets.find((asset) => asset.channel === "blog");

  if (!blogAsset) {
    throw new ProjectContentNotFoundError(projectId);
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
  const wordpress =
    options?.wordpress && options.wordpress.siteUrl && options.wordpress.username && options.wordpress.appPassword
      ? await publishToWordPress({
          siteUrl: options.wordpress.siteUrl,
          username: options.wordpress.username,
          appPassword: options.wordpress.appPassword,
          status: options.wordpress.status,
          title: publishPackage.title,
          slug: publishPackage.slug,
          excerpt: publishPackage.summary,
          content: publishPackage.bodyHtml,
          coverImageUrl: publishPackage.coverImageUrl,
          categoryNames: options.wordpress.categoryNames,
          tagNames:
            options.wordpress.tagNames ||
            blogAsset.hashtags
              ?.split(",")
              .map((tag) => tag.trim().replace(/^#/, ""))
              .filter(Boolean)
              .join(", "),
        })
      : null;
  const updated = wordpress
    ? await saveLatestContentJobPublishResult({
        projectId,
        status: options?.wordpress?.status === "publish" ? "published" : "ready_to_publish",
        publishProvider: "wordpress",
        externalPostId: String(wordpress.postId),
        externalPostUrl: wordpress.link,
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
    wordpress,
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
