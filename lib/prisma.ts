import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Vercel preview/production should prefer pooled Neon URLs.
// Local tooling can still fall back to direct/non-pooling URLs if needed.
const pooledDatabaseUrl =
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

const directDatabaseUrl =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

function withServerlessPoolSettings(url?: string) {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);

    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", "1");
    }

    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "30");
    }

    if (
      (parsed.hostname.includes("-pooler.") || parsed.hostname.includes("-pooler-")) &&
      !parsed.searchParams.has("pgbouncer")
    ) {
      parsed.searchParams.set("pgbouncer", "true");
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

const runtimeDatabaseUrl = process.env.VERCEL
  ? withServerlessPoolSettings(pooledDatabaseUrl) || directDatabaseUrl
  : directDatabaseUrl || pooledDatabaseUrl;

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
