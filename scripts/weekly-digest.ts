import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

type JsonRecord = Record<string, unknown>;

function startOfDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number) {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function textFromPayload(payload: unknown, key: string) {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    key in payload
  ) {
    const value = (payload as JsonRecord)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

async function collectDigestData() {
  const { prisma } = await import("../lib/db/client");
  const since = startOfDaysAgo(7);

  const [
    messages,
    closedGaps,
    openGaps,
    correctionsApplied,
    curatedDocuments,
    unansweredEvents,
    localFallbackEvents,
    delegationEvents,
  ] = await Promise.all([
    prisma.message.count({ where: { createdAt: { gte: since } } }),
    prisma.processGapQuestion.count({
      where: { status: { in: ["answered", "closed"] }, answeredAt: { gte: since } },
    }),
    prisma.processGapQuestion.count({
      where: { status: { in: ["open", "promoted"] } },
    }),
    prisma.chunkFeedback.count({
      where: { status: "APPROVED", updatedAt: { gte: since } },
    }),
    prisma.curationDocument.count({
      where: { status: "PROMOTED", promotedAt: { gte: since } },
    }),
    prisma.auditEvent.findMany({
      where: { eventType: "agent.unanswered", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, payload: true },
    }),
    prisma.auditEvent.count({
      where: {
        eventType: "delegation.local_fallback",
        createdAt: { gte: since },
      },
    }),
    prisma.agentCall.count({ where: { createdAt: { gte: since } } }),
  ]);

  return {
    since,
    messages,
    closedGaps,
    openGaps,
    correctionsApplied,
    curatedDocuments,
    unansweredEvents,
    localFallbackEvents,
    delegationEvents,
  };
}

function renderDigest(data: Awaited<ReturnType<typeof collectDigestData>>) {
  const fallbackRate = percent(data.localFallbackEvents, data.delegationEvents);
  const fallbackAlert =
    data.delegationEvents > 0 &&
    data.localFallbackEvents / data.delegationEvents > 0.05;

  const lines = [
    `# Digest semanal - ${isoDate()}`,
    "",
    `Periodo: ${data.since.toISOString()} ate ${new Date().toISOString()}`,
    "",
    "## Indicadores",
    "",
    `- Mensagens na semana: ${data.messages}`,
    `- Lacunas fechadas/respondidas: ${data.closedGaps}`,
    `- Lacunas abertas atuais: ${data.openGaps}`,
    `- Correcoes aplicadas: ${data.correctionsApplied}`,
    `- Documentos curados promovidos: ${data.curatedDocuments}`,
    `- Perguntas sem resposta na semana: ${data.unansweredEvents.length}`,
    `- Fallback local de delegacao: ${data.localFallbackEvents}/${data.delegationEvents} (${fallbackRate})`,
  ];

  if (fallbackAlert) {
    lines.push(
      "",
      "## Alerta tecnico",
      "",
      `**ALERTA: Bus instável, ${fallbackRate} das delegações recorreram ao fallback local.** Verificar RabbitMQ, consumidores e timeouts antes de ampliar o piloto.`,
    );
  }

  lines.push("", "## Top perguntas sem resposta", "");

  if (data.unansweredEvents.length === 0) {
    lines.push("- Nenhuma pergunta sem resposta registrada no periodo.");
  } else {
    for (const event of data.unansweredEvents.slice(0, 5)) {
      const question = textFromPayload(event.payload, "question") ?? "Pergunta nao registrada no payload";
      const sector = textFromPayload(event.payload, "sector") ?? "setor desconhecido";
      lines.push(`- ${event.createdAt.toISOString()} | ${sector} | ${question}`);
    }
  }

  lines.push(
    "",
    "## Envio",
    "",
    "- Nesta Onda 0, este arquivo deve ser enviado manualmente ao patrocinador.",
    "- O envio automatico via Teams depende de `TEAMS_WEBHOOK_DIGEST`, previsto para a Onda 1.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const data = await collectDigestData();
  const markdown = renderDigest(data);
  const outputDir = path.join(process.cwd(), "docs", "pmo", "weekly-digest");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${isoDate()}.md`);
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Digest gravado em ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
