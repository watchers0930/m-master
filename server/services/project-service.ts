import { logger } from "../logger";
import { createProjectWithSeeds, getProjectDetail, listProjects } from "../repositories/project-repository";
import { buildContextDraft } from "./context-draft-service";
import { analyzeSourceFiles } from "./source-analysis-service";
import { buildStudioSeed } from "./studio-seed-service";
import { buildTopicRecommendations } from "./topic-recommendation-service";
import type { CreateProjectInput } from "../validators/project-validator";

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

function serializeProjectListItem(
  item: Awaited<ReturnType<typeof listProjects>>[number],
) {
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
      title: topic.title,
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
      title: topic.title,
      intentType: topic.intentType,
      score: topic.score,
      rationale: topic.rationale,
      createdAt: topic.createdAt,
    })),
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

  const studioSeed = buildStudioSeed(record.brandProfile, record.topics);

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
      title: topic.title,
      intentType: topic.intentType,
      score: topic.score,
    })),
    draft: studioSeed,
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
