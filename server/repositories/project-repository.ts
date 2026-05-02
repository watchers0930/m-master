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
      imageJobs: Array<{
        id: string;
        channelPreset: string;
        prompt: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        imageAssets: Array<{
          id: string;
          role: string;
          originalPath: string | null;
          composedPath: string | null;
          width: number | null;
          height: number | null;
          selected: boolean;
          version: number;
          createdAt: Date;
          updatedAt: Date;
        }>;
      }>;
    }>;
  } | null;
};

const projectSummaryInclude = {
  brandProfiles: {
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
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
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    }),
    prisma.topicCandidate.findMany({
      where: { projectId },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    }),
    prisma.contentJob.findFirst({
      where: { projectId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        assets: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            imageJobs: {
              orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              include: {
                imageAssets: {
                  orderBy: [{ createdAt: "asc" }],
                },
              },
            },
          },
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

export async function deleteProjectById(projectId: string) {
  return prisma.project.delete({
    where: { id: projectId },
  });
}

export async function saveBrandProfileDraft(params: {
  projectId: string;
  summary: string;
  audience?: string;
  tone?: string;
  cta?: string;
  bannedTerms?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const latestProfile = await tx.brandProfile.findFirst({
      where: { projectId: params.projectId },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });

    if (latestProfile && !latestProfile.approved) {
      return tx.brandProfile.update({
        where: { id: latestProfile.id },
        data: {
          summary: params.summary,
          audience: params.audience,
          tone: params.tone,
          cta: params.cta,
          bannedTerms: params.bannedTerms,
          approved: false,
          approvedAt: null,
        },
      });
    }

    return tx.brandProfile.create({
      data: {
        projectId: params.projectId,
        version: (latestProfile?.version ?? 0) + 1,
        summary: params.summary,
        audience: params.audience,
        tone: params.tone,
        cta: params.cta,
        bannedTerms: params.bannedTerms,
        approved: false,
        approvedAt: null,
      },
    });
  });
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

    const latestProfile = await tx.brandProfile.findFirst({
      where: { projectId: params.projectId },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });

    if (latestProfile && !latestProfile.approved) {
      return tx.brandProfile.update({
        where: { id: latestProfile.id },
        data: {
          summary: params.summary,
          audience: params.audience,
          tone: params.tone,
          cta: params.cta,
          bannedTerms: params.bannedTerms,
          approved: true,
          approvedAt: new Date(),
        },
      });
    }

    return tx.brandProfile.create({
      data: {
        projectId: params.projectId,
        version: (latestProfile?.version ?? 0) + 1,
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

export async function replaceProjectTopics(params: {
  projectId: string;
  topics: Array<{
    title: string;
    intentType: string;
    score: number;
    rationale: string;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.topicCandidate.deleteMany({
      where: { projectId: params.projectId },
    });

    if (params.topics.length === 0) {
      return [];
    }

    await tx.topicCandidate.createMany({
      data: params.topics.map((topic) => ({
        projectId: params.projectId,
        title: topic.title,
        intentType: topic.intentType,
        score: topic.score,
        rationale: topic.rationale,
      })),
    });

    return tx.topicCandidate.findMany({
      where: { projectId: params.projectId },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    });
  });
}

export async function createOrUpdateContentJobWithAssets(params: {
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
  return prisma.$transaction(async (tx) => {
    const latestJob = await tx.contentJob.findFirst({
      where: { projectId: params.projectId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        assets: true,
      },
    });

    if (latestJob && latestJob.topic === params.topic) {
      await tx.contentJob.update({
        where: { id: latestJob.id },
        data: {
          objective: params.objective,
          status: "generated",
        },
      });

      for (const asset of params.assets) {
        const existingAsset = latestJob.assets.find((item) => item.channel === asset.channel);

        if (existingAsset) {
          await tx.contentAsset.update({
            where: { id: existingAsset.id },
            data: {
              title: asset.title,
              body: asset.body,
              cta: asset.cta,
              version: existingAsset.version + 1,
            },
          });
          continue;
        }

        await tx.contentAsset.create({
          data: {
            contentJobId: latestJob.id,
            channel: asset.channel,
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
          },
        });
      }

      return tx.contentJob.findUniqueOrThrow({
        where: { id: latestJob.id },
        include: {
          assets: {
            orderBy: [{ createdAt: "asc" }],
          },
        },
      });
    }

    return tx.contentJob.create({
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
  });
}

export async function updateContentAssetDraft(params: {
  projectId: string;
  contentJobId: string;
  assetId: string;
  title?: string;
  body: string;
  cta?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.contentAsset.findFirst({
      where: {
        id: params.assetId,
        contentJobId: params.contentJobId,
        contentJob: {
          projectId: params.projectId,
        },
      },
    });

    if (!asset) {
      return null;
    }

    await tx.contentJob.update({
      where: { id: params.contentJobId },
      data: {
        status: "editing",
      },
    });

    return tx.contentAsset.update({
      where: { id: params.assetId },
      data: {
        title: params.title,
        body: params.body,
        cta: params.cta,
        version: asset.version + 1,
      },
    });
  });
}

export async function saveLatestContentJobAssets(params: {
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
  return prisma.$transaction(async (tx) => {
    const latestContentJob = await tx.contentJob.findFirst({
      where: { projectId: params.projectId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        assets: true,
      },
    });

    if (!latestContentJob) {
      return tx.contentJob.create({
        data: {
          projectId: params.projectId,
          topic: params.topic,
          objective: params.objective,
          status: "draft",
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

    await tx.contentJob.update({
      where: { id: latestContentJob.id },
      data: {
        topic: params.topic,
        objective: params.objective,
        status: "draft",
      },
    });

    const latestAssetVersions = new Map(
      latestContentJob.assets.map((asset) => [asset.channel, asset.version]),
    );

    for (const asset of params.assets) {
      const existing = latestContentJob.assets.find((item) => item.channel === asset.channel);

      if (existing) {
        await tx.contentAsset.update({
          where: { id: existing.id },
          data: {
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
            version: (latestAssetVersions.get(asset.channel) ?? existing.version) + 1,
          },
        });
      } else {
        await tx.contentAsset.create({
          data: {
            contentJobId: latestContentJob.id,
            channel: asset.channel,
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
          },
        });
      }
    }

    return tx.contentJob.findUniqueOrThrow({
      where: { id: latestContentJob.id },
      include: {
        assets: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });
  });
}

export async function listProjectBrandProfiles(projectId: string) {
  return prisma.brandProfile.findMany({
    where: { projectId },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });
}

export async function listProjectContentJobs(projectId: string) {
  return prisma.contentJob.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      assets: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}

export async function updateLatestContentJobStatus(projectId: string, status: string) {
  const latestContentJob = await prisma.contentJob.findFirst({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!latestContentJob) {
    return null;
  }

  return prisma.contentJob.update({
    where: { id: latestContentJob.id },
    data: { status },
  });
}

export async function createImageJobWithAssets(params: {
  contentAssetId: string;
  channelPreset: string;
  prompt: string;
  imageAssets: Array<{
    role: string;
    originalPath?: string;
    composedPath?: string;
    width?: number;
    height?: number;
    selected?: boolean;
  }>;
}) {
  return prisma.imageJob.create({
    data: {
      contentAssetId: params.contentAssetId,
      channelPreset: params.channelPreset,
      prompt: params.prompt,
      status: "generated",
      imageAssets: {
        create: params.imageAssets.map((asset) => ({
          role: asset.role,
          originalPath: asset.originalPath,
          composedPath: asset.composedPath,
          width: asset.width,
          height: asset.height,
          selected: asset.selected ?? false,
        })),
      },
    },
    include: {
      imageAssets: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}

export async function selectImageAssetForContentAsset(params: {
  contentAssetId: string;
  imageAssetId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const imageJobIds = (
      await tx.imageJob.findMany({
        where: { contentAssetId: params.contentAssetId },
        select: { id: true },
      })
    ).map((job) => job.id);

    if (imageJobIds.length === 0) {
      return null;
    }

    const asset = await tx.imageAsset.findFirst({
      where: {
        id: params.imageAssetId,
        imageJobId: { in: imageJobIds },
      },
    });

    if (!asset) {
      return null;
    }

    await tx.imageAsset.updateMany({
      where: {
        imageJobId: { in: imageJobIds },
      },
      data: {
        selected: false,
      },
    });

    return tx.imageAsset.update({
      where: { id: params.imageAssetId },
      data: { selected: true },
    });
  });
}
