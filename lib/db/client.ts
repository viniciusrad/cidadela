import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { appConfig } from "@/lib/config";

const globalForPrisma = globalThis as typeof globalThis & {
  __cidadelaPrisma?: PrismaClient;
};

const adapter = new PrismaPg({
  connectionString: appConfig.databaseUrl,
});

function hasRequiredDelegates(client: PrismaClient) {
  const maybeClient = client as PrismaClient & {
    curationDocument?: unknown;
    documentCorrelationRun?: unknown;
    documentReview?: unknown;
    documentApproval?: unknown;
    knowledgeOwner?: unknown;
    knowledgeCapability?: unknown;
    chunkFeedback?: unknown;
    processMap?: unknown;
    processGapQuestion?: unknown;
  };

  return (
    Boolean(maybeClient.curationDocument) &&
    Boolean(maybeClient.documentCorrelationRun) &&
    Boolean(maybeClient.documentReview) &&
    Boolean(maybeClient.documentApproval) &&
    Boolean(maybeClient.knowledgeOwner) &&
    Boolean(maybeClient.knowledgeCapability) &&
    Boolean(maybeClient.chunkFeedback) &&
    Boolean(maybeClient.processMap) &&
    Boolean(maybeClient.processGapQuestion)
  );
}

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function disconnectQuietly(client: PrismaClient) {
  void client.$disconnect().catch(() => undefined);
}

function ensurePrismaClient() {
  const cachedPrisma = globalForPrisma.__cidadelaPrisma;

  if (cachedPrisma && !hasRequiredDelegates(cachedPrisma)) {
    disconnectQuietly(cachedPrisma);
    globalForPrisma.__cidadelaPrisma = undefined;
  }

  const nextClient = globalForPrisma.__cidadelaPrisma ?? createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__cidadelaPrisma = nextClient;
  }

  return nextClient;
}

export function getPrismaClient() {
  return ensurePrismaClient();
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = ensurePrismaClient();
    const value = Reflect.get(client as object, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;

ensurePrismaClient();
