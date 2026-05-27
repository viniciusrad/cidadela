import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

type Sector = "desenvolvimento" | "seguranca" | "suporte" | "desktop";

type Citation = {
  score?: number;
};

type EngineResult = {
  sector: Sector;
  question: string;
  ok: boolean;
  citations: Citation[];
  durationMs: number;
  error?: string;
  metrics?: { totalDurationMs?: number };
};

type ChatEvent = {
  type?: string;
  data?: {
    citations?: Citation[];
    metrics?: { totalDurationMs?: number };
  };
  message?: string;
};

const SECTORS: Sector[] = [
  "desenvolvimento",
  "seguranca",
  "suporte",
  "desktop",
];

const MIN_RELEVANT_SCORE = Number(process.env.KPI_MIN_CITATION_SCORE ?? "0.3");
const DEFAULT_MAX_QUESTIONS = 80;

function argValue(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  return process.env[`npm_config_${name.replace(/-/g, "_")}`];
}

function hasFlag(name: string) {
  return (
    process.argv.includes(`--${name}`) ||
    process.env[`npm_config_${name.replace(/-/g, "_")}`] === "true"
  );
}

function clampQuestionLimit(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_QUESTIONS;
  return Math.min(Math.floor(parsed), 100);
}

function isoStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function percent(numerator: number, denominator: number) {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function p95(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function titleFromMarkdown(fileName: string, markdown: string) {
  const heading = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (heading) return heading.replace(/^#+\s*/, "").trim();
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function firstUsefulLines(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length >= 20 && line.length <= 180)
    .slice(0, 3);
}

function buildQuestions(sector: Sector, fileName: string, markdown: string) {
  const title = titleFromMarkdown(fileName, markdown);
  const lines = firstUsefulLines(markdown);
  const base = [
    `Resuma os pontos principais de "${title}" para o setor ${sector}.`,
    `Quais procedimentos, regras ou cuidados aparecem em "${title}"?`,
    `Quais sistemas, responsaveis, entradas ou excecoes sao citados em "${title}"?`,
  ];

  return [...base, ...lines.map((line) => `Explique este trecho no contexto do setor ${sector}: ${line}`)];
}

async function collectSeedQuestions(limit: number) {
  const questions: Array<{ sector: Sector; question: string }> = [];

  for (const sector of SECTORS) {
    const sectorDir = path.join(process.cwd(), "seed-docs", sector);
    const files = await readdir(sectorDir).catch(() => []);

    for (const fileName of files.filter((file) => file.endsWith(".md"))) {
      const markdown = await readFile(path.join(sectorDir, fileName), "utf8");
      for (const question of buildQuestions(sector, fileName, markdown)) {
        questions.push({ sector, question });
      }
    }
  }

  const repeated = [...questions];
  let cursor = 0;
  while (repeated.length > 0 && repeated.length < limit) {
    const item = questions[cursor % questions.length];
    repeated.push({
      sector: item.sector,
      question: `${item.question} Responda de forma objetiva. Rodada ${Math.floor(cursor / questions.length) + 2}.`,
    });
    cursor += 1;
  }

  return repeated.slice(0, limit);
}

function relevantCitationCount(citations: Citation[]) {
  return citations.filter(
    (citation) =>
      citation.score === undefined || citation.score >= MIN_RELEVANT_SCORE,
  ).length;
}

async function runEngineQuestion(input: {
  sector: Sector;
  question: string;
}): Promise<EngineResult> {
  const [{ ensureBusBootstrapped }, { runSectorAgent }] = await Promise.all([
    import("../lib/bus/bootstrap"),
    import("../lib/agents/base-agent"),
  ]);

  await ensureBusBootstrapped().catch(() => undefined);

  const traceId = randomUUID();
  const startedAt = Date.now();
  let finalMetrics: EngineResult["metrics"] | undefined;
  try {
    const result = await runSectorAgent({
      traceId,
      sector: input.sector,
      question: input.question,
      emit: (event) => {
        if (event.type === "done") {
          finalMetrics = event.data.metrics;
        }
      },
    });
    return {
      ...input,
      ok: true,
      citations: result.citations,
      durationMs: Date.now() - startedAt,
      metrics: finalMetrics,
    };
  } catch (error) {
    return {
      ...input,
      ok: false,
      citations: [],
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runHttpQuestion(input: {
  sector: Sector;
  question: string;
  appUrl: string;
  cookie: string;
}): Promise<EngineResult> {
  const startedAt = Date.now();
  const response = await fetch(new URL("/api/chat", input.appUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: input.cookie,
    },
    body: JSON.stringify({
      question: input.question,
      agentId: input.sector,
      useRag: true,
      useGraph: true,
    }),
  });

  if (!response.ok || !response.body) {
    return {
      sector: input.sector,
      question: input.question,
      ok: false,
      citations: [],
      durationMs: Date.now() - startedAt,
      error: `HTTP ${response.status}: ${await response.text()}`,
    };
  }

  const events = await response.text();
  const parsed = events
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ChatEvent;
      } catch {
        return { type: "parse_error", message: line } satisfies ChatEvent;
      }
    });

  const done = [...parsed].reverse().find((event) => event.type === "done");
  const error = parsed.find((event) => event.type === "error");

  return {
    sector: input.sector,
    question: input.question,
    ok: !error,
    citations: done?.data?.citations ?? [],
    durationMs: Date.now() - startedAt,
    metrics: done?.data?.metrics,
    error: error?.message,
  };
}

async function collectDatabaseCounters(since: Date) {
  const { prisma } = await import("../lib/db/client");

  const [
    assistantMessages,
    userQuestions,
    unansweredEvents,
    localFallbackEvents,
    feedbackEvents,
    agentCalls,
  ] = await Promise.all([
    prisma.message.findMany({
      where: { role: "assistant", createdAt: { gte: since } },
      select: { citations: true },
    }),
    prisma.auditEvent.count({
      where: { eventType: "user.question", createdAt: { gte: since } },
    }),
    prisma.auditEvent.count({
      where: { eventType: "agent.unanswered", createdAt: { gte: since } },
    }),
    prisma.auditEvent.count({
      where: {
        eventType: "delegation.local_fallback",
        createdAt: { gte: since },
      },
    }),
    prisma.auditEvent.findMany({
      where: { eventType: "user.feedback", createdAt: { gte: since } },
      select: { payload: true },
    }),
    prisma.agentCall.findMany({
      where: { createdAt: { gte: since } },
      select: { latencyMs: true },
    }),
  ]);

  const assistantWithRelevantCitation = assistantMessages.filter((message) => {
    const citations = Array.isArray(message.citations) ? message.citations : [];
    return relevantCitationCount(citations as Citation[]) > 0;
  }).length;

  const positiveFeedback = feedbackEvents.filter((event) => {
    const payload = event.payload;
    return (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "value" in payload &&
      payload.value === "good"
    );
  }).length;

  const latencies = agentCalls
    .map((call) => call.latencyMs)
    .filter((value): value is number => typeof value === "number");

  return {
    assistantMessages: assistantMessages.length,
    assistantWithRelevantCitation,
    userQuestions,
    unansweredEvents,
    localFallbackEvents,
    feedbackEvents: feedbackEvents.length,
    positiveFeedback,
    agentCallLatencyP95Ms: p95(latencies),
  };
}

function renderMarkdown(input: {
  mode: string;
  startedAt: Date;
  finishedAt: Date;
  results: EngineResult[];
  databaseCounters: Awaited<ReturnType<typeof collectDatabaseCounters>>;
}) {
  const successes = input.results.filter((result) => result.ok);
  const withCitation = successes.filter(
    (result) => relevantCitationCount(result.citations) > 0,
  );
  const durations = input.results.map(
    (result) => result.metrics?.totalDurationMs ?? result.durationMs,
  );
  const failures = input.results.filter((result) => !result.ok);

  const lines = [
    `# KPI snapshot - ${input.finishedAt.toISOString()}`,
    "",
    "## Execucao",
    "",
    `- Modo: ${input.mode}`,
    `- Inicio: ${input.startedAt.toISOString()}`,
    `- Fim: ${input.finishedAt.toISOString()}`,
    `- Perguntas sinteticas: ${input.results.length}`,
    `- Threshold de citacao relevante: ${MIN_RELEVANT_SCORE}`,
    "",
    "## Metricas da execucao sintetica",
    "",
    `- Respostas com sucesso: ${successes.length}/${input.results.length} (${percent(successes.length, input.results.length)})`,
    `- Respostas com citacao relevante: ${withCitation.length}/${successes.length} (${percent(withCitation.length, successes.length)})`,
    `- Latencia p95 observada: ${p95(durations)} ms`,
    `- Falhas: ${failures.length}`,
    "",
    "## Contadores do banco desde o inicio da execucao",
    "",
    `- Mensagens assistant: ${input.databaseCounters.assistantMessages}`,
    `- Mensagens assistant com citacao relevante: ${input.databaseCounters.assistantWithRelevantCitation}`,
    `- Eventos user.question: ${input.databaseCounters.userQuestions}`,
    `- Eventos agent.unanswered: ${input.databaseCounters.unansweredEvents}`,
    `- Taxa agent.unanswered: ${percent(input.databaseCounters.unansweredEvents, input.databaseCounters.userQuestions)}`,
    `- Eventos delegation.local_fallback: ${input.databaseCounters.localFallbackEvents}`,
    `- Feedback positivo: ${input.databaseCounters.positiveFeedback}/${input.databaseCounters.feedbackEvents} (${percent(input.databaseCounters.positiveFeedback, input.databaseCounters.feedbackEvents)})`,
    `- Latencia p95 em AgentCall: ${input.databaseCounters.agentCallLatencyP95Ms} ms`,
  ];

  if (failures.length > 0) {
    lines.push("", "## Falhas", "");
    for (const failure of failures.slice(0, 20)) {
      lines.push(
        `- ${failure.sector}: ${failure.error ?? "erro sem mensagem"} | ${failure.question}`,
      );
    }
  }

  lines.push("", "## Amostra", "");
  for (const result of input.results.slice(0, 20)) {
    lines.push(
      `- ${result.sector}: ${result.ok ? "ok" : "falha"} | citacoes=${relevantCitationCount(result.citations)} | ${result.durationMs}ms | ${result.question}`,
    );
  }

  lines.push(
    "",
    "## Observacoes",
    "",
    "- O modo engine mede o motor local sem criar mensagens/conversas; use o modo http com cookie de admin para medir exatamente `/api/chat` autenticado.",
    "- Para modo http, defina `PFRM_BASELINE_AUTH_COOKIE` com o cookie de sessao do navegador e rode a aplicacao em `NEXTAUTH_URL`.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const mode = argValue("mode") ?? "engine";
  const maxQuestions = clampQuestionLimit(argValue("max"));
  const startedAt = new Date();
  const questions = await collectSeedQuestions(maxQuestions);

  if (questions.length === 0) {
    throw new Error("Nenhuma pergunta seed foi gerada a partir de seed-docs/.");
  }

  if (hasFlag("list-only") || hasFlag("dry-run")) {
    for (const item of questions) {
      console.log(`[${item.sector}] ${item.question}`);
    }
    return;
  }

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3030";
  const cookie = process.env.PFRM_BASELINE_AUTH_COOKIE;

  if (mode === "http" && !cookie) {
    throw new Error(
      "Modo http exige PFRM_BASELINE_AUTH_COOKIE com uma sessao autenticada. Use cookie de admin para medir todos os setores.",
    );
  }

  const results: EngineResult[] = [];
  for (const [index, item] of questions.entries()) {
    console.log(
      `[${index + 1}/${questions.length}] ${mode} ${item.sector}: ${item.question}`,
    );
    const result =
      mode === "http"
        ? await runHttpQuestion({ ...item, appUrl, cookie: cookie ?? "" })
        : await runEngineQuestion(item);
    results.push(result);
  }

  const finishedAt = new Date();
  const databaseCounters = await collectDatabaseCounters(startedAt);
  const markdown = renderMarkdown({
    mode,
    startedAt,
    finishedAt,
    results,
    databaseCounters,
  });

  const outputDir = path.join(process.cwd(), "docs", "pmo", "kpi-snapshots");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${isoStamp(finishedAt)}.md`);
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Snapshot gravado em ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
