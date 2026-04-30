import type { Prisma, Project } from "@prisma/client";

import { prisma } from "../../lib/prisma";

export type ProjectDetailRecord = {
  project: Project;
  brandProfile: {
    id: string;
    version: number;
    summary: string;
    audience: string | null;
    tone: string | null;
    cta: string | null;
    bannedTerms: string | null;
    approved: boolean;
    approvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  topics: Array<{
    id: string;
    title: string;
    intentType: string | null;
    score: number | null;
    rationale: string | null;
    createdAt: Date;
  }>;
};

const projectSummaryInclude = {
  brandProfiles: {
    orderBy: [{ approved: "desc" }, { createdAt: "desc" }],
    take: 1,
  },
  topics: {
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
  },
  _count: {
    select: {
      topics: true,
      contentJobs: true,
    },
  },
} satisfies Prisma.ProjectInclude;

export async function createProjectWithSeeds(params: {
  project: {
    name: string;
    domain?: string;
    workingPath?: string;
  };
  brandProfile: {
    summary: string;
    audience?: string;
    tone?: string;
    cta?: string;
    bannedTerms?: string;
  };
  topics: Array<{
    title: string;
    intentType: string;
    score: number;
    rationale: string;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: params.project.name,
        domain: params.project.domain,
        workingPath: params.project.workingPath,
      },
    });

    await tx.brandProfile.create({
      data: {
        projectId: project.id,
        summary: params.brandProfile.summary,
        audience: params.brandProfile.audience,
        tone: params.brandProfile.tone,
        cta: params.brandProfile.cta,
        bannedTerms: params.brandProfile.bannedTerms,
      },
    });

    if (params.topics.length > 0) {
      await tx.topicCandidate.createMany({
        data: params.topics.map((topic) => ({
          projectId: project.id,
          title: topic.title,
          intentType: topic.intentType,
          score: topic.score,
          rationale: topic.rationale,
        })),
      });
    }

    return project.id;
  });
}

export async function listProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: projectSummaryInclude,
  });
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetailRecord | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    return null;
  }

  const [brandProfile, topics] = await Promise.all([
    prisma.brandProfile.findFirst({
      where: { projectId },
      orderBy: [{ approved: "desc" }, { createdAt: "desc" }],
    }),
    prisma.topicCandidate.findMany({
      where: { projectId },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  return {
    project,
    brandProfile,
    topics,
  };
}
