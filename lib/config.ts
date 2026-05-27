import { z } from "zod";

import { SECTORS, type Sector } from "@/lib/domain";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  AUTH_SECRET: z.string().min(1).default("troque-esta-chave-local"),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3030"),
  DATABASE_URL: z
    .string()
    .default("postgresql://pfrm:pfrm@127.0.0.1:5544/pfrm_agents"),
  QDRANT_URL: z.string().url().default("http://127.0.0.1:6433"),
  QDRANT_API_KEY: optionalString,
  QDRANT_COLLECTION_SECURITY: z.string().default("rag_security"),
  QDRANT_COLLECTION_SUPPORT: z.string().default("rag_support"),
  QDRANT_COLLECTION_DEV: z.string().default("rag_dev"),
  QDRANT_COLLECTION_DESKTOP: z.string().default("rag_desktop"),
  QDRANT_STAGING_COLLECTION_SECURITY: z
    .string()
    .default("rag_security_staging"),
  QDRANT_STAGING_COLLECTION_SUPPORT: z.string().default("rag_support_staging"),
  QDRANT_STAGING_COLLECTION_DEV: z.string().default("rag_dev_staging"),
  QDRANT_STAGING_COLLECTION_DESKTOP: z.string().default("rag_desktop_staging"),
  QDRANT_VECTOR_SIZE: z.coerce.number().int().positive().default(1024),
  SOP_OUTPUT_DIR: z.string().default("./files/sop"),
  SOP_READINESS_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  CURATION_REQUIRES_OWNER_APPROVAL: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  CURATION_REQUIRES_ADMIN_APPROVAL: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  CURATION_ALLOW_SAME_USER_DUAL_APPROVAL: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  OLLAMA_HOST_MODE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  OLLAMA_URL: z.string().url().optional(),
  OLLAMA_EMBED_MODEL: z.string().default("bge-m3:latest"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen3.5:4b"),
  OLLAMA_CLASSIFIER_MODEL: z.string().optional(),
  RERANKER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  RERANKER_MODEL: z.string().default("bge-reranker-v2-m3"),
  RABBITMQ_URL: z.string().default("amqp://pfrm:pfrm@127.0.0.1:5673"),
  RABBITMQ_MANAGEMENT_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:15673"),
  CHAT_TOP_K: z.coerce.number().int().positive().default(5),
  CHAT_LOCAL_CONFIDENCE_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.5),
  BUS_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  BUS_BOOTSTRAP_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  ROUTER_MODE: z.enum(["rules-first"]).default("rules-first"),
  HUMAN_CAPTCHA_API_URL: z.string().url().default("http://127.0.0.1:3001"),
  HUMAN_CAPTCHA_INTERNAL_TOKEN: z.string().optional(),
  HUMAN_CAPTCHA_CERVELLO_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10000),
  HUMAN_CAPTCHA_AUTOMATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  HUMAN_CAPTCHA_CERVELLO_PROCESS_KEY: z
    .string()
    .default("problemas-pedido-eletronico"),
  HUMAN_CAPTCHA_MEDICATION_PRICE_PROCESS_KEY: z
    .string()
    .default("medication-price-survey"),
  HUMAN_CAPTCHA_CURRENCY_INDEX_PROCESS_KEY: z
    .string()
    .default("coleta-indices-moedas"),
  SEARCH_PORTAL_URL: z.string().url().default("http://localhost:3110"),
  SEARCH_PORTAL_PUBLIC_URL: z.string().url().optional(),
  SEARCH_PORTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SEARCH_PORTAL_ALLOWED_SECTORS: z.string().default("desenvolvimento"),
  MCP_EDI_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  MCP_EDI_URL: z.string().url().default("http://127.0.0.1:3400/mcp"),
  MCP_EDI_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  MCP_EDI_ALLOWED_SECTORS: z.string().default("desenvolvimento"),
  NEO4J_URI: z.string().default("bolt://127.0.0.1:7688"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("sua_senha_aqui"),
  TEAMS_WEBHOOK_GAPS: optionalUrl,
  TEAMS_WEBHOOK_DIGEST: optionalUrl,
  NOTIFICATIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  NOTIFICATIONS_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000),
  WEEKLY_DIGEST_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),
  PILOT_USER_EMAILS: z.string().optional(),
  PILOT_SECTOR: z.string().optional(),
  PILOT_START_DATE: z.string().optional(),
  PILOT_SPONSOR: z.string().optional(),
  PILOT_CHAMPION: z.string().optional(),
});

const parsedEnv = envSchema.parse(process.env);

const env = {
  ...parsedEnv,
  OLLAMA_URL: parsedEnv.OLLAMA_HOST_MODE
    ? "http://127.0.0.1:11434"
    : (parsedEnv.OLLAMA_URL || "http://127.0.0.1:11500"),
};

export const SECTOR_COLLECTIONS: Record<Sector, string> = {
  desenvolvimento: env.QDRANT_COLLECTION_DEV,
  seguranca: env.QDRANT_COLLECTION_SECURITY,
  suporte: env.QDRANT_COLLECTION_SUPPORT,
  desktop: env.QDRANT_COLLECTION_DESKTOP,
};

export const STAGING_SECTOR_COLLECTIONS: Record<Sector, string> = {
  desenvolvimento: env.QDRANT_STAGING_COLLECTION_DEV,
  seguranca: env.QDRANT_STAGING_COLLECTION_SECURITY,
  suporte: env.QDRANT_STAGING_COLLECTION_SUPPORT,
  desktop: env.QDRANT_STAGING_COLLECTION_DESKTOP,
};

export const appConfig = {
  authSecret: env.AUTH_SECRET,
  authTrustHost: env.AUTH_TRUST_HOST,
  nextAuthUrl: env.NEXTAUTH_URL,
  databaseUrl: env.DATABASE_URL,
  qdrantUrl: env.QDRANT_URL,
  qdrantApiKey: env.QDRANT_API_KEY,
  qdrantVectorSize: env.QDRANT_VECTOR_SIZE,
  sopOutputDir: env.SOP_OUTPUT_DIR,
  sopReadinessThreshold: env.SOP_READINESS_THRESHOLD,
  curationRequiresOwnerApproval: env.CURATION_REQUIRES_OWNER_APPROVAL,
  curationRequiresAdminApproval: env.CURATION_REQUIRES_ADMIN_APPROVAL,
  curationAllowSameUserDualApproval:
    env.CURATION_ALLOW_SAME_USER_DUAL_APPROVAL,
  ollamaUrl: env.OLLAMA_URL,
  ollamaEmbedModel: env.OLLAMA_EMBED_MODEL,
  ollamaChatModel: env.OLLAMA_CHAT_MODEL,
  ollamaClassifierModel: env.OLLAMA_CLASSIFIER_MODEL || env.OLLAMA_CHAT_MODEL,
  rerankerEnabled: env.RERANKER_ENABLED,
  rerankerModel: env.RERANKER_MODEL,
  rabbitmqUrl: env.RABBITMQ_URL,
  rabbitmqManagementUrl: env.RABBITMQ_MANAGEMENT_URL,
  chatTopK: env.CHAT_TOP_K,
  chatLocalConfidenceThreshold: env.CHAT_LOCAL_CONFIDENCE_THRESHOLD,
  busRpcTimeoutMs: env.BUS_RPC_TIMEOUT_MS,
  busBootstrapEnabled: env.BUS_BOOTSTRAP_ENABLED,
  routerMode: env.ROUTER_MODE,
  humanCaptchaApiUrl: env.HUMAN_CAPTCHA_API_URL,
  humanCaptchaInternalToken: env.HUMAN_CAPTCHA_INTERNAL_TOKEN,
  humanCaptchaCervelloTimeoutMs: env.HUMAN_CAPTCHA_CERVELLO_TIMEOUT_MS,
  humanCaptchaAutomationTimeoutMs:
    env.HUMAN_CAPTCHA_AUTOMATION_TIMEOUT_MS ??
    env.HUMAN_CAPTCHA_CERVELLO_TIMEOUT_MS,
  humanCaptchaCervelloProcessKey: env.HUMAN_CAPTCHA_CERVELLO_PROCESS_KEY,
  humanCaptchaMedicationPriceProcessKey:
    env.HUMAN_CAPTCHA_MEDICATION_PRICE_PROCESS_KEY,
  humanCaptchaCurrencyIndexProcessKey: env.HUMAN_CAPTCHA_CURRENCY_INDEX_PROCESS_KEY,
  searchPortalUrl: env.SEARCH_PORTAL_URL,
  searchPortalPublicUrl: env.SEARCH_PORTAL_PUBLIC_URL ?? env.SEARCH_PORTAL_URL,
  searchPortalTimeoutMs: env.SEARCH_PORTAL_TIMEOUT_MS,
  searchPortalAllowedSectors: env.SEARCH_PORTAL_ALLOWED_SECTORS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  mcpEdiEnabled: env.MCP_EDI_ENABLED,
  mcpEdiUrl: env.MCP_EDI_URL,
  mcpEdiTimeoutMs: env.MCP_EDI_TIMEOUT_MS,
  mcpEdiAllowedSectors: env.MCP_EDI_ALLOWED_SECTORS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  neo4jUri: env.NEO4J_URI,
  neo4jUser: env.NEO4J_USER,
  neo4jPassword: env.NEO4J_PASSWORD,
  teamsWebhookGaps: env.TEAMS_WEBHOOK_GAPS,
  teamsWebhookDigest: env.TEAMS_WEBHOOK_DIGEST,
  notificationsEnabled: env.NOTIFICATIONS_ENABLED,
  notificationsIntervalMs: env.NOTIFICATIONS_INTERVAL_MS,
  weeklyDigestIntervalMs: env.WEEKLY_DIGEST_INTERVAL_MS,
};

export function collectionForSector(sector: string) {
  if (sector in SECTOR_COLLECTIONS) {
    return SECTOR_COLLECTIONS[sector as Sector];
  }
  // Dynamic sector: derive collection name from slug
  return `rag_${sector.replace(/-/g, "_")}`;
}

export function stagingCollectionForSector(sector: string) {
  if (sector in STAGING_SECTOR_COLLECTIONS) {
    return STAGING_SECTOR_COLLECTIONS[sector as Sector];
  }
  return `rag_${sector.replace(/-/g, "_")}_staging`;
}

export function isSector(value: string): value is Sector {
  return SECTORS.includes(value as Sector);
}

