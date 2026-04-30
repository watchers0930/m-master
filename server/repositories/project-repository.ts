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
  latestContentJob: {
    id: string;
    topic: string;
    objective: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    assets: Array<{
      id: string;
      channel: string;
      title: string | null;
      body: string;
      cta: string | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } | null;
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

  const [brandProfile, topics, latestContentJob] = await Promise.all([
    prisma.brandProfile.findFirst({
      where: { projectId },
      orderBy: [{ approved: "desc" }, { createdAt: "desc" }],
    }),
    prisma.topicCandidate.findMany({
      where: { projectId },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    }),
    prisma.contentJob.findFirst({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        assets: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    }),
  ]);

  return {
    project,
    brandProfile,
    topics,
    latestContentJob,
  };
}

export async function approveBrandProfileVersion(params: {
  projectId: string;
  summary: string;
  audience?: string;
  tone?: string;
  cta?: string;
  bannedTerms?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.brandProfile.updateMany({
      where: {
        projectId: params.projectId,
        approved: true,
      },
      data: {
        approved: false,
      },
    });

    const latestVersion =
      (await tx.brandProfile.aggregate({
        where: { projectId: params.projectId },
        _max: { version: true },
      }))._max.version ?? 0;

    return tx.brandProfile.create({
      data: {
        projectId: params.projectId,
        version: latestVersion + 1,
        summary: params.summary,
        audience: params.audience,
        tone: params.tone,
        cta: params.cta,
        bannedTerms: params.bannedTerms,
        approved: true,
        approvedAt: new Date(),
      },
    });
  });
}

export async function createContentJobWithAssets(params: {
  projectId: string;
  topic: string;
  objective?: string;
  assets: Array<{
    channel: string;
    title?: string;
    body: string;
    cta?: string;
  }>;
}) {
  return prisma.contentJob.create({
    data: {
      projectId: params.projectId,
      topic: params.topic,
      objective: params.objective,
      status: "generated",
      assets: {
        create: params.assets.map((asset) => ({
          channel: asset.channel,
          title: asset.title,
          body: asset.body,
          cta: asset.cta,
        })),
      },
    },
    include: {
      assets: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}
