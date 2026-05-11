import { PrismaClient } from "@prisma/client";

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required.");
  process.exit(1);
}

if (sourceUrl === targetUrl) {
  console.error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL must be different.");
  process.exit(1);
}

const source = new PrismaClient({
  datasources: { db: { url: sourceUrl } },
});

const target = new PrismaClient({
  datasources: { db: { url: targetUrl } },
});

const batches = (items, size = 50) => {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
};

const copyRows = async ({ label, read, upsert }) => {
  const rows = await read();
  console.log(`${label}: found ${rows.length}`);

  for (const chunk of batches(rows)) {
    await target.$transaction(chunk.map((row) => upsert(row)));
  }

  console.log(`${label}: copied ${rows.length}`);
};

const main = async () => {
  await copyRows({
    label: "Project",
    read: () => source.project.findMany(),
    upsert: (row) =>
      target.project.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });

  await copyRows({
    label: "BrandProfile",
    read: () => source.brandProfile.findMany(),
    upsert: (row) =>
      target.brandProfile.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });

  await copyRows({
    label: "TopicCandidate",
    read: () => source.topicCandidate.findMany(),
    upsert: (row) =>
      target.topicCandidate.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });

  await copyRows({
    label: "ContentJob",
    read: () => source.contentJob.findMany(),
    upsert: (row) =>
      target.contentJob.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });

  await copyRows({
    label: "ContentAsset",
    read: () => source.contentAsset.findMany(),
    upsert: (row) =>
      target.contentAsset.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });

  await copyRows({
    label: "ImageJob",
    read: () => source.imageJob.findMany(),
    upsert: (row) =>
      target.imageJob.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });

  await copyRows({
    label: "ImageAsset",
    read: () => source.imageAsset.findMany(),
    upsert: (row) =>
      target.imageAsset.upsert({
        where: { id: row.id },
        create: row,
        update: row,
      }),
  });
};

try {
  await main();
} finally {
  await source.$disconnect();
  await target.$disconnect();
}
