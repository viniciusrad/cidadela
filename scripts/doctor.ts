import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  appConfig,
  SECTOR_COLLECTIONS,
  STAGING_SECTOR_COLLECTIONS,
} from "../lib/config";
import { prisma } from "../lib/db/client";
import { checkQdrantHealth, listQdrantCollections } from "../lib/qdrant";
import { checkNeo4jHealth } from "../lib/neo4j";
import { checkOllamaHealth, getEmbedding } from "../lib/ollama";
import { getBusConnection } from "../lib/bus/connection";

// Preflight do ambiente local: valida em um passo unico tudo que a app toca no
// boot (instrumentation.ts) e no primeiro chat. Usa `appConfig` como fonte unica
// de verdade — nao le process.env por conta propria — para que o diagnostico
// reflita exatamente a configuracao que a aplicacao vai enxergar.

type Status = "ok" | "warn" | "fail";

const results: { name: string; status: Status }[] = [];
const TIMEOUT_MS = 15_000;
const ROOT = process.cwd();

function record(name: string, status: Status, detail: string) {
  results.push({ name, status });
  const icon = status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} ${name.padEnd(10)} ${detail}`);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function maskCredentials(url: string) {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

async function withTimeout<T>(work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout apos ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Roda um check; qualquer excecao vira uma linha de falha em vez de derrubar o preflight. */
async function check(name: string, work: () => Promise<void>) {
  try {
    await withTimeout(work);
  } catch (error) {
    record(name, "fail", message(error));
  }
}

function checkEnvFiles() {
  const hasLocal = existsSync(path.join(ROOT, ".env.local"));
  const hasEnv = existsSync(path.join(ROOT, ".env"));

  if (!hasLocal && !hasEnv) {
    record("env", "fail", "sem .env.local e sem .env — copie de .env.local.example");
    return;
  }

  // O Next le .env.local; o Prisma CLI (prisma.config.ts) le .env.local e .env.
  // Ter so um dos dois funciona, mas o par garante paridade entre a app e os
  // comandos de migracao/seed.
  const present = [hasLocal && ".env.local", hasEnv && ".env"]
    .filter(Boolean)
    .join(" + ");

  if (appConfig.authSecret === "troque-esta-chave-local") {
    record("env", "warn", `${present} · AUTH_SECRET ainda e o placeholder`);
    return;
  }

  record("env", "ok", present);
}

async function checkPostgres() {
  await prisma.$queryRaw`SELECT 1`;

  const applied = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  );
  const appliedCount = Number(applied[0]?.count ?? 0);
  const onDisk = readdirSync(path.join(ROOT, "prisma", "migrations"), {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory()).length;

  if (appliedCount < onDisk) {
    record(
      "postgres",
      "fail",
      `${appliedCount}/${onDisk} migrations aplicadas — rode "npx prisma migrate deploy"`,
    );
    return;
  }

  const users = await prisma.user.count();
  const base = `${maskCredentials(appConfig.databaseUrl)} · ${onDisk} migrations`;

  if (users === 0) {
    record("postgres", "warn", `${base} · sem usuarios — rode "npm run seed"`);
    return;
  }

  record("postgres", "ok", `${base} · ${users} usuarios`);
}

async function checkQdrant() {
  await checkQdrantHealth();

  const expected = Array.from(
    new Set([
      ...Object.values(SECTOR_COLLECTIONS),
      ...Object.values(STAGING_SECTOR_COLLECTIONS),
    ]),
  );
  const existing = new Set(await listQdrantCollections());
  const missing = expected.filter((name) => !existing.has(name));

  if (missing.length > 0) {
    // As colecoes nascem sob demanda (ensureCollection). Ausencia antes do
    // primeiro seed/ingest e esperada, entao e aviso e nao falha.
    record(
      "qdrant",
      "warn",
      `${appConfig.qdrantUrl} · colecoes ausentes: ${missing.join(", ")}`,
    );
    return;
  }

  record(
    "qdrant",
    "ok",
    `${appConfig.qdrantUrl} · ${expected.length} colecoes de setor presentes`,
  );
}

async function checkRabbit() {
  const connection = await getBusConnection();
  const channel = await connection.createChannel();
  await channel.close();
  record(
    "rabbitmq",
    "ok",
    `${maskCredentials(appConfig.rabbitmqUrl)} · painel em ${appConfig.rabbitmqManagementUrl}`,
  );
}

async function checkNeo4j() {
  if (!(await checkNeo4jHealth())) {
    throw new Error(`sem conectividade em ${appConfig.neo4jUri}`);
  }
  record("neo4j", "ok", `${appConfig.neo4jUri} · usuario ${appConfig.neo4jUser}`);
}

async function checkOllama() {
  // checkOllamaHealth ja falha se o modelo de chat ou de embedding nao estiver
  // instalado; aqui so acrescentamos a checagem de dimensao do vetor.
  await checkOllamaHealth();

  const embedding = await getEmbedding("checagem de ambiente");
  if (embedding.length !== appConfig.qdrantVectorSize) {
    throw new Error(
      `${appConfig.ollamaEmbedModel} devolve ${embedding.length} dimensoes, mas QDRANT_VECTOR_SIZE=${appConfig.qdrantVectorSize}`,
    );
  }

  record(
    "ollama",
    "ok",
    `${appConfig.ollamaUrl} · chat=${appConfig.ollamaChatModel} · embed=${appConfig.ollamaEmbedModel} (${embedding.length}d)`,
  );
}

async function main() {
  console.log("Checagem do ambiente Cidadela\n");

  checkEnvFiles();
  await check("postgres", checkPostgres);
  await check("qdrant", checkQdrant);
  await check("rabbitmq", checkRabbit);
  await check("neo4j", checkNeo4j);
  await check("ollama", checkOllama);

  const failures = results.filter((result) => result.status === "fail");
  const warnings = results.filter((result) => result.status === "warn");

  console.log("");
  if (failures.length > 0) {
    console.log(
      `${failures.length} falha(s): ${failures.map((f) => f.name).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    warnings.length > 0
      ? `Ambiente utilizavel, com ${warnings.length} aviso(s).`
      : "Ambiente pronto.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("[doctor] erro inesperado:", message(error));
  process.exit(1);
});
