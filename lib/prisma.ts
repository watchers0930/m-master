import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Vercel/Neon environments may expose multiple Postgres URLs.
// Prefer direct/non-pooling URLs at runtime to avoid pooled connection failures
// taking down all project APIs.
const runtimeDatabaseUrl =
  process.env.DIRECT_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (runtimeDatabaseUrl) {
  process.env.DATABASE_URL = runtimeDatabaseUrl;
  process.env.DIRECT_URL = process.env.DIRECT_URL || runtimeDatabaseUrl;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: runtimeDatabaseUrl
      ? {
          db: {
            url: runtimeDatabaseUrl,
          },
        }
      : undefined,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
