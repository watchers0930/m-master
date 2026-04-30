import { logger } from "../logger";
import {
  approveBrandProfileVersion,
  createOrUpdateContentJobWithAssets,
  createProjectWithSeeds,
  deleteProjectById,
  getProjectDetail,
  listProjects,
  saveBrandProfileDraft,
  saveLatestContentJobAssets,
} from "../repositories/project-repository";
import { buildContextDraft } from "./context-draft-service";
import { buildReviewSummary } from "./review-service";
import { analyzeSourceFiles } from "./source-analysis-service";
import { buildStudioSeed } from "./studio-seed-service";
import { buildTopicRecommendations, normalizeTopicTitle } from "./topic-recommendation-service";
import type { CreateProjectInput } from "../validators/project-validator";

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    this.name = "ProjectNotFoundError";
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
          })),
        }
      : null,
  };
}

export async function createProject(input: CreateProjectInput) {
  logger.info("project.create.start", {
    name: input.name,
    domain: input.domain,
    hasWorkingPath: Boolean(input.workingPath),
    sourceFileCount: input.sourceFiles.length,
  });

  const sourceAnalysis = analyzeSourceFiles(input.sourceFiles);
  const contextDraft = buildContextDraft(input, sourceAnalysis);
  const topics = buildTopicRecommendations({
    projectName: input.name,
    domain: input.domain,
    contextDraft,
    sourceAnalysis,
  });

  const projectId = await createProjectWithSeeds({
    project: input,
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
    },
    review,
    analysisMode: "client-source-metadata-and-excerpt",
  };
}

export function previewProjectContext(input: CreateProjectInput) {
  const sourceAnalysis = analyzeSourceFiles(input.sourceFiles);
  const contextDraft = buildContextDraft(input, sourceAnalysis);
  const topics = buildTopicRecommendations({
    projectName: input.name,
    domain: input.domain,
    contextDraft,
    sourceAnalysis,
  });

  return {
    contextDraft,
    topics,
    sourceAnalysis,
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

export async function generateProjectContent(params: {
  projectId: string;
  topic?: string;
  topicId?: string;
  objective?: string;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record || !record.brandProfile) {
    throw new ProjectNotFoundError(params.projectId);
  }

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
  const record = await getProjectDetail(params.projectId);

  if (!record || !record.brandProfile) {
    throw new ProjectNotFoundError(params.projectId);
  }

  const normalizedTopic = normalizeTopicTitle(params.topic, record.project.name);

  await saveLatestContentJobAssets({
    projectId: params.projectId,
    topic: normalizedTopic,
    objective: params.objective,
    assets: params.assets,
  });

  return getProjectStudioSeed(params.projectId);
}
