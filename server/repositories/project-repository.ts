import crypto from "crypto";
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
    generationProvider: string | null;
    publishProvider: string | null;
    externalPostId: string | null;
    externalPostUrl: string | null;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    publications: Array<{
      id: string;
      channel: string;
      provider: string;
      status: string;
      externalPostId: string | null;
      externalPostUrl: string | null;
      payloadSummary: string | null;
      errorMessage: string | null;
      publishedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    assets: Array<{
      id: string;
      channel: string;
      title: string | null;
      body: string;
      cta: string | null;
      hashtags: string | null;
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

export type ContentPlanRecord = {
  id: string;
  projectId: string;
  monthKey: string;
  status: string;
  basisSummary: string | null;
  autoGenerate: boolean;
  generatedAt: Date | null;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    sortOrder: number;
    weekLabel: string;
    publishAt: Date | null;
    topic: string;
    intentType: string | null;
    objective: string | null;
    rationale: string | null;
    status: string;
    attemptCount: number;
    lastError: string | null;
    reviewSnapshot: string | null;
    lastProcessedAt: Date | null;
    contentJobId: string | null;
    generatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

export type AutomationBatchRunRecord = {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  actorLabel: string | null;
  executionSource: string | null;
  durationMs: number | null;
  completedCount: number;
  failedCount: number;
  itemsSnapshot: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectOperatorRecord = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CredentialCheckRunRecord = {
  id: string;
  projectId: string;
  service: string;
  kind: string;
  status: string;
  actorLabel: string | null;
  summary: string;
  detail: string | null;
  expiresAt: Date | null;
  checkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
    industry?: string;
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
        industry: params.project.industry,
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

export async function updateProjectSettings(params: {
  projectId: string;
  industry?: string;
  ga4PropertyId?: string;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressAppPasswordEncrypted?: string | null;
  wordpressStatus?: string;
  wordpressCategoryNames?: string;
  wordpressTagNames?: string;
  bloggerBlogId?: string;
  bloggerAccessTokenEncrypted?: string | null;
  bloggerStatus?: string;
  metaAccessTokenEncrypted?: string | null;
  metaTokenExpiresAt?: Date | null;
  facebookPageId?: string;
  instagramBusinessAccountId?: string;
  operationsAlertWebhookEncrypted?: string | null;
  alertPolicyMode?: string;
  alertQuietHoursStart?: string;
  alertQuietHoursEnd?: string;
  alertTimezone?: string;
  alertOnBlockedReadiness?: boolean;
  automationMode?: string;
  automationRequireReview?: boolean;
  automationMinOverallScore?: number;
  automationMinRiskScore?: number;
}) {
  return prisma.project.update({
    where: { id: params.projectId },
    data: {
      industry: params.industry,
      ga4PropertyId: params.ga4PropertyId,
      wordpressSiteUrl: params.wordpressSiteUrl,
      wordpressUsername: params.wordpressUsername,
      wordpressAppPasswordEncrypted: params.wordpressAppPasswordEncrypted,
      wordpressStatus: params.wordpressStatus,
      wordpressCategoryNames: params.wordpressCategoryNames,
      wordpressTagNames: params.wordpressTagNames,
      bloggerBlogId: params.bloggerBlogId,
      bloggerAccessTokenEncrypted: params.bloggerAccessTokenEncrypted,
      bloggerStatus: params.bloggerStatus,
      metaAccessTokenEncrypted: params.metaAccessTokenEncrypted,
      metaTokenExpiresAt: params.metaTokenExpiresAt,
      facebookPageId: params.facebookPageId,
      instagramBusinessAccountId: params.instagramBusinessAccountId,
      operationsAlertWebhookEncrypted: params.operationsAlertWebhookEncrypted,
      alertPolicyMode: params.alertPolicyMode,
      alertQuietHoursStart: params.alertQuietHoursStart,
      alertQuietHoursEnd: params.alertQuietHoursEnd,
      alertTimezone: params.alertTimezone,
      alertOnBlockedReadiness: params.alertOnBlockedReadiness,
      automationMode: params.automationMode,
      automationRequireReview: params.automationRequireReview,
      automationMinOverallScore: params.automationMinOverallScore,
      automationMinRiskScore: params.automationMinRiskScore,
    },
  });
}

export async function listProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: projectSummaryInclude,
  });
}

export async function listProjectsForOperatorIdentity(params: {
  name: string;
  accessKeyHash: string;
}) {
  return prisma.project.findMany({
    where: {
      operators: {
        some: {
          name: params.name,
          accessKeyHash: params.accessKeyHash,
          active: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
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
        publications: {
          orderBy: [{ createdAt: "desc" }],
        },
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
  generationProvider?: string;
  assets: Array<{
    channel: string;
    title?: string;
    body: string;
    cta?: string;
    hashtags?: string;
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
          generationProvider: params.generationProvider,
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
              hashtags: asset.hashtags,
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
            hashtags: asset.hashtags,
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
        generationProvider: params.generationProvider,
        status: "generated",
        assets: {
          create: params.assets.map((asset) => ({
            channel: asset.channel,
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
            hashtags: asset.hashtags,
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
  hashtags?: string;
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
        hashtags: params.hashtags,
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
    hashtags?: string;
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
              hashtags: asset.hashtags,
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
            hashtags: asset.hashtags,
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
            hashtags: asset.hashtags,
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
      publications: {
        orderBy: [{ createdAt: "desc" }],
      },
      assets: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}

export async function getProjectContentPlan(projectId: string, monthKey: string): Promise<ContentPlanRecord | null> {
  return prisma.contentPlan.findUnique({
    where: {
      projectId_monthKey: {
        projectId,
        monthKey,
      },
    },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function getLatestProjectContentPlan(projectId: string): Promise<ContentPlanRecord | null> {
  return prisma.contentPlan.findFirst({
    where: { projectId },
    orderBy: [{ monthKey: "desc" }, { updatedAt: "desc" }],
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function saveProjectContentPlan(params: {
  projectId: string;
  monthKey: string;
  status: string;
  basisSummary?: string;
  autoGenerate?: boolean;
  generatedAt?: Date | null;
  lastExecutedAt?: Date | null;
  items: Array<{
    sortOrder: number;
    weekLabel: string;
    publishAt?: Date | null;
    topic: string;
    intentType?: string;
    objective?: string;
    rationale?: string;
    status?: string;
    contentJobId?: string | null;
    generatedAt?: Date | null;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.contentPlan.findUnique({
      where: {
        projectId_monthKey: {
          projectId: params.projectId,
          monthKey: params.monthKey,
        },
      },
      select: { id: true },
    });

    const planId = existing?.id ?? crypto.randomUUID();

    await tx.contentPlan.upsert({
      where: {
        projectId_monthKey: {
          projectId: params.projectId,
          monthKey: params.monthKey,
        },
      },
      create: {
        id: planId,
        projectId: params.projectId,
        monthKey: params.monthKey,
        status: params.status,
        basisSummary: params.basisSummary,
        autoGenerate: params.autoGenerate ?? false,
        generatedAt: params.generatedAt ?? null,
        lastExecutedAt: params.lastExecutedAt ?? null,
        updatedAt: now,
      },
      update: {
        status: params.status,
        basisSummary: params.basisSummary,
        autoGenerate: params.autoGenerate ?? false,
        generatedAt: params.generatedAt ?? null,
        lastExecutedAt: params.lastExecutedAt ?? null,
        updatedAt: now,
      },
    });

    await tx.contentPlanItem.deleteMany({
      where: { contentPlanId: planId },
    });

    if (params.items.length > 0) {
      await tx.contentPlanItem.createMany({
        data: params.items.map((item) => ({
          id: crypto.randomUUID(),
          contentPlanId: planId,
          sortOrder: item.sortOrder,
          weekLabel: item.weekLabel,
          publishAt: item.publishAt ?? null,
          topic: item.topic,
          intentType: item.intentType,
          objective: item.objective,
          rationale: item.rationale,
          status: item.status ?? "planned",
          attemptCount: 0,
          lastError: null,
          reviewSnapshot: null,
          lastProcessedAt: null,
          contentJobId: item.contentJobId ?? null,
          generatedAt: item.generatedAt ?? null,
          updatedAt: now,
        })),
      });
    }

    return tx.contentPlan.findUniqueOrThrow({
      where: { id: planId },
      include: {
        items: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });
  });
}

export async function attachContentJobToPlanItem(params: {
  projectId: string;
  planItemId: string;
  contentJobId: string;
  status?: string;
  generatedAt?: Date | null;
}) {
  const item = await prisma.contentPlanItem.findFirst({
    where: {
      id: params.planItemId,
      contentPlan: {
        projectId: params.projectId,
      },
    },
    select: { id: true },
  });

  if (!item) {
    return null;
  }

  return prisma.contentPlanItem.update({
    where: { id: params.planItemId },
    data: {
      contentJobId: params.contentJobId,
      status: params.status ?? "generated",
      lastError: null,
      reviewSnapshot: null,
      generatedAt: params.generatedAt ?? new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function getProjectContentPlanItemByContentJobId(params: {
  projectId: string;
  contentJobId: string;
}) {
  return prisma.contentPlanItem.findFirst({
    where: {
      contentJobId: params.contentJobId,
      contentPlan: {
        projectId: params.projectId,
      },
    },
    select: {
      id: true,
      status: true,
      reviewSnapshot: true,
      lastError: true,
      contentJobId: true,
    },
  });
}

export async function listDueContentPlanItems(referenceTime: Date, projectId?: string) {
  return prisma.contentPlanItem.findMany({
    where: {
      publishAt: {
        lte: referenceTime,
      },
      status: {
        in: ["planned", "failed"],
      },
      ...(projectId
        ? {
            contentPlan: {
              projectId,
            },
          }
        : {}),
    },
    orderBy: [{ publishAt: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      contentPlan: {
        include: {
          project: true,
        },
      },
    },
  });
}

export async function getProjectContentPlanItem(params: {
  projectId: string;
  planItemId: string;
}) {
  return prisma.contentPlanItem.findFirst({
    where: {
      id: params.planItemId,
      contentPlan: {
        projectId: params.projectId,
      },
    },
    include: {
      contentPlan: {
        include: {
          project: true,
        },
      },
    },
  });
}

export async function markContentPlanItemStatus(params: {
  planItemId: string;
  status: string;
  lastError?: string | null;
  reviewSnapshot?: string | null;
  contentJobId?: string | null;
  generatedAt?: Date | null;
}) {
  return prisma.contentPlanItem.update({
    where: { id: params.planItemId },
    data: {
      status: params.status,
      attemptCount: {
        increment: 1,
      },
      lastError: params.lastError ?? null,
      reviewSnapshot: params.reviewSnapshot ?? null,
      lastProcessedAt: new Date(),
      contentJobId: params.contentJobId ?? undefined,
      generatedAt: params.generatedAt ?? undefined,
      updatedAt: new Date(),
    },
  });
}

export async function updateContentPlanItemReviewState(params: {
  planItemId: string;
  status: string;
  lastError?: string | null;
  reviewSnapshot?: string | null;
}) {
  return prisma.contentPlanItem.update({
    where: { id: params.planItemId },
    data: {
      status: params.status,
      lastError: params.lastError ?? null,
      reviewSnapshot: params.reviewSnapshot ?? null,
      lastProcessedAt: new Date(),
      updatedAt: new Date(),
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

export async function saveLatestContentJobPublishResult(params: {
  projectId: string;
  status: string;
  publishProvider?: string | null;
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  publishedAt?: Date | null;
}) {
  const latestContentJob = await prisma.contentJob.findFirst({
    where: { projectId: params.projectId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!latestContentJob) {
    return null;
  }

  return prisma.contentJob.update({
    where: { id: latestContentJob.id },
    data: {
      status: params.status,
      publishProvider: params.publishProvider ?? null,
      externalPostId: params.externalPostId ?? null,
      externalPostUrl: params.externalPostUrl ?? null,
      publishedAt: params.publishedAt ?? null,
    },
  });
}

export async function createChannelPublication(params: {
  contentJobId: string;
  channel: string;
  provider: string;
  status: string;
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  payloadSummary?: string | null;
  errorMessage?: string | null;
  publishedAt?: Date | null;
}) {
  return prisma.channelPublication.create({
    data: {
      contentJobId: params.contentJobId,
      channel: params.channel,
      provider: params.provider,
      status: params.status,
      externalPostId: params.externalPostId ?? null,
      externalPostUrl: params.externalPostUrl ?? null,
      payloadSummary: params.payloadSummary ?? null,
      errorMessage: params.errorMessage ?? null,
      publishedAt: params.publishedAt ?? null,
    },
  });
}

export async function getImageAssetById(imageAssetId: string) {
  return prisma.imageAsset.findUnique({
    where: { id: imageAssetId },
  });
}

export async function listProjectChannelPublications(projectId: string, limit = 20) {
  return prisma.channelPublication.findMany({
    where: {
      contentJob: {
        projectId,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: Math.max(1, Math.min(limit, 100)),
  });
}

export async function createAutomationBatchRun(params: {
  projectId: string;
  kind: string;
  label: string;
  actorLabel?: string | null;
  executionSource?: string | null;
  durationMs?: number | null;
  completedCount: number;
  failedCount: number;
  itemsSnapshot?: string | null;
}) {
  return prisma.automationBatchRun.create({
    data: {
      projectId: params.projectId,
      kind: params.kind,
      label: params.label,
      actorLabel: params.actorLabel ?? null,
      executionSource: params.executionSource ?? null,
      durationMs: params.durationMs ?? null,
      completedCount: params.completedCount,
      failedCount: params.failedCount,
      itemsSnapshot: params.itemsSnapshot ?? null,
    },
  });
}

export async function listProjectAutomationBatchRuns(projectId: string, limit = 10) {
  return prisma.automationBatchRun.findMany({
    where: {
      projectId,
    },
    orderBy: [{ createdAt: "desc" }],
    take: Math.max(1, Math.min(limit, 50)),
  });
}

export async function createCredentialCheckRun(params: {
  projectId: string;
  service: string;
  kind: string;
  status: string;
  actorLabel?: string | null;
  summary: string;
  detail?: string | null;
  expiresAt?: Date | null;
  checkedAt?: Date;
}) {
  return prisma.credentialCheckRun.create({
    data: {
      projectId: params.projectId,
      service: params.service,
      kind: params.kind,
      status: params.status,
      actorLabel: params.actorLabel ?? null,
      summary: params.summary,
      detail: params.detail ?? null,
      expiresAt: params.expiresAt ?? null,
      checkedAt: params.checkedAt ?? new Date(),
    },
  });
}

export async function listProjectCredentialCheckRuns(projectId: string, limit = 25) {
  return prisma.credentialCheckRun.findMany({
    where: {
      projectId,
    },
    orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(limit, 100)),
  });
}

export async function listProjectOperators(projectId: string) {
  return prisma.projectOperator.findMany({
    where: {
      projectId,
    },
    orderBy: [{ role: "desc" }, { name: "asc" }],
  });
}

export async function createProjectOperator(params: {
  projectId: string;
  name: string;
  role: string;
  accessKeyHash: string;
}) {
  return prisma.projectOperator.create({
    data: {
      projectId: params.projectId,
      name: params.name,
      role: params.role,
      accessKeyHash: params.accessKeyHash,
      active: true,
    },
  });
}

export async function updateProjectOperator(params: {
  operatorId: string;
  role?: string;
  active?: boolean;
  accessKeyHash?: string;
}) {
  return prisma.projectOperator.update({
    where: {
      id: params.operatorId,
    },
    data: {
      role: params.role,
      active: params.active,
      accessKeyHash: params.accessKeyHash,
    },
  });
}

export async function getProjectOperatorByName(params: {
  projectId: string;
  name: string;
}) {
  return prisma.projectOperator.findFirst({
    where: {
      projectId: params.projectId,
      name: params.name,
    },
  });
}

export async function getProjectOperatorById(params: {
  projectId: string;
  operatorId: string;
}) {
  return prisma.projectOperator.findFirst({
    where: {
      id: params.operatorId,
      projectId: params.projectId,
    },
  });
}

export async function countProjectOperators(projectId: string) {
  return prisma.projectOperator.count({
    where: {
      projectId,
    },
  });
}

export async function createProjectOperatorSession(params: {
  operatorId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.projectOperatorSession.create({
    data: {
      operatorId: params.operatorId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
    },
  });
}

export async function getProjectOperatorSessionByTokenHash(tokenHash: string) {
  return prisma.projectOperatorSession.findUnique({
    where: {
      tokenHash,
    },
    include: {
      operator: true,
    },
  });
}

export async function touchProjectOperatorSession(params: {
  sessionId: string;
  operatorId: string;
}) {
  const now = new Date();
  await prisma.projectOperatorSession.update({
    where: {
      id: params.sessionId,
    },
    data: {
      lastUsedAt: now,
    },
  });

  await prisma.projectOperator.update({
    where: {
      id: params.operatorId,
    },
    data: {
      lastUsedAt: now,
    },
  });
}

export async function deleteProjectOperatorSessionByTokenHash(tokenHash: string) {
  return prisma.projectOperatorSession.deleteMany({
    where: {
      tokenHash,
    },
  });
}

export async function deleteExpiredProjectOperatorSessions(now = new Date()) {
  return prisma.projectOperatorSession.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });
}

export async function getProjectChannelPublication(params: {
  projectId: string;
  publicationId: string;
}) {
  return prisma.channelPublication.findFirst({
    where: {
      id: params.publicationId,
      contentJob: {
        projectId: params.projectId,
      },
    },
    include: {
      contentJob: {
        include: {
          project: true,
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
      },
    },
  });
}

export async function getProjectContentJob(params: {
  projectId: string;
  contentJobId: string;
}) {
  return prisma.contentJob.findFirst({
    where: {
      id: params.contentJobId,
      projectId: params.projectId,
    },
    include: {
      publications: {
        orderBy: [{ createdAt: "desc" }],
      },
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

export async function createContentJobVariant(params: {
  projectId: string;
  topic: string;
  objective?: string;
  generationProvider?: string;
  variantGroupId: string;
  variantLabel: string;
  assets: Array<{
    channel: string;
    title?: string;
    body: string;
    cta?: string;
    hashtags?: string;
    metaDescription?: string;
  }>;
}) {
  return prisma.contentJob.create({
    data: {
      projectId: params.projectId,
      topic: params.topic,
      objective: params.objective,
      generationProvider: params.generationProvider,
      status: "generated",
      variantGroupId: params.variantGroupId,
      variantLabel: params.variantLabel,
      adopted: false,
      assets: {
        create: params.assets.map((asset) => ({
          channel: asset.channel,
          title: asset.title,
          body: asset.body,
          cta: asset.cta,
          hashtags: asset.hashtags,
          metaDescription: asset.metaDescription,
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

export async function getVariantGroup(projectId: string, groupId: string) {
  return prisma.contentJob.findMany({
    where: {
      projectId,
      variantGroupId: groupId,
    },
    orderBy: [{ createdAt: "asc" }],
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
  });
}

export async function adoptVariant(contentJobId: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.contentJob.findUnique({
      where: { id: contentJobId },
    });

    if (!target || !target.variantGroupId) {
      return null;
    }

    await tx.contentJob.updateMany({
      where: {
        projectId: target.projectId,
        variantGroupId: target.variantGroupId,
      },
      data: { adopted: false },
    });

    return tx.contentJob.update({
      where: { id: contentJobId },
      data: { adopted: true },
      include: {
        assets: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });
  });
}

export async function getLatestVariantGroup(projectId: string) {
  const latest = await prisma.contentJob.findFirst({
    where: {
      projectId,
      variantGroupId: { not: null },
    },
    orderBy: [{ createdAt: "desc" }],
    select: { variantGroupId: true },
  });

  if (!latest?.variantGroupId) {
    return [];
  }

  return getVariantGroup(projectId, latest.variantGroupId);
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
