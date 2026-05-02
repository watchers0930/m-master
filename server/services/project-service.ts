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
  saveLatestContentJobAssets,
  selectImageAssetForContentAsset,
  updateLatestContentJobStatus,
} from "../repositories/project-repository";
import { buildContextDraft } from "./context-draft-service";
import { buildImageVariants } from "./image-studio-service";
import { buildReviewSummary } from "./review-service";
import { analyzeSourceFiles } from "./source-analysis-service";
import { buildStudioSeed } from "./studio-seed-service";
import { buildTopicRecommendations, normalizeTopicTitle } from "./topic-recommendation-service";
import { fetchWebsiteSource } from "./website-source-service";
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
      workingPath: record.project.workingPath,
      status: record.project.status,
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
    profile: record.brandProfile,
    topics: record.topics,
  });
  const normalizedLatestTopic = normalizeTopicTitle(record.latestContentJob?.topic ?? seed.topic, record.project.name);
  const persistedAssetPayload = persistedAssets.map((asset) => ({
    channel: asset.channel as "blog" | "instagram" | "facebook",
    title: asset.title ?? "",
    body: asset.body,
    cta: asset.cta ?? "",
  }));
  const usePersistedAssets =
    persistedAssetPayload.length > 0 &&
    !isLegacyContentShape({
      topic: record.latestContentJob?.topic ?? "",
      assets: persistedAssetPayload,
    });
  const assets = usePersistedAssets
    ? persistedAssetPayload
    : buildStudioSeed({
        projectName: record.project.name,
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
  const seed = buildStudioSeed({
    projectName: record.project.name,
    profile: record.brandProfile,
    topics: [{ title: normalizedTopic, score: 10 }],
  });

  await createOrUpdateContentJobWithAssets({
    projectId: params.projectId,
    topic: normalizedTopic,
    objective: params.objective || seed.objective,
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
    kind: job.status === "ready_to_publish" ? "publish-ready" : "content-saved",
    title:
      job.status === "ready_to_publish"
        ? `${job.topic} 발행 준비 완료`
        : `${job.topic} 콘텐츠 저장`,
    description: `${job.assets.length}개 채널 초안 · 상태 ${job.status}`,
    timestamp: job.updatedAt.toISOString(),
  }));

  return [...brandEvents, ...contentEvents].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export async function exportProjectContent(projectId: string) {
  requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);
  const studio = await getProjectStudioSeed(projectId);

  if (!studio.draft.assets.length) {
    throw new ProjectContentNotFoundError(projectId);
  }

  const slug = studio.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const channels = studio.draft.assets.map((asset) => ({
    channel: asset.channel,
    filename: `${slug}-${asset.channel}.md`,
    title: asset.title,
    content: [`# ${asset.title}`, "", asset.body, "", "CTA", asset.cta].join("\n"),
  }));

  return {
    generatedAt: new Date().toISOString(),
    jsonFilename: `${slug}-export.json`,
    channels,
  };
}

export async function markProjectReadyForPublish(projectId: string) {
  requireApprovedBrandProfile(await getProjectDetail(projectId), projectId);

  const updated = await updateLatestContentJobStatus(projectId, "ready_to_publish");

  if (!updated) {
    throw new ProjectContentNotFoundError(projectId);
  }

  return {
    projectId,
    contentJobId: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
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
