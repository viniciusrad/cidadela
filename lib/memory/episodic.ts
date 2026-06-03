import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { prisma } from "@/lib/db/client";
import { appConfig } from "@/lib/config";
import { getEmbedding, generateAnswerStream } from "@/lib/ollama";

export type EpisodeRecord = {
  id: string;
  conversationId: string;
  sector: string;
  summary: string;
  feedbackScore: number | null;
  reviewStatus: string;
  reviewedBy: string | null;
  qdrantPointId: string | null;
  createdAt: Date;
};

function getQdrantClient(): QdrantClient {
  return new QdrantClient({
    url: appConfig.qdrantUrl,
    ...(appConfig.qdrantApiKey ? { apiKey: appConfig.qdrantApiKey } : {}),
  });
}

export function memoryCollectionName(sector: string): string {
  return `memory_${sector.replace(/-/g, "_")}`;
}

export async function ensureMemoryCollection(sector: string): Promise<void> {
  const client = getQdrantClient();
  const name = memoryCollectionName(sector);
  try {
    await client.getCollection(name);
  } catch {
    await client.createCollection(name, {
      vectors: { size: appConfig.qdrantVectorSize, distance: "Cosine" },
    });
    await client.createPayloadIndex(name, {
      field_name: "episodeId",
      field_schema: "keyword",
      wait: true,
    });
    await client.createPayloadIndex(name, {
      field_name: "reviewStatus",
      field_schema: "keyword",
      wait: true,
    });
  }
}

async function summarizeConversation(
  messages: { role: string; content: string }[],
): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Usuário" : "Agente"}: ${m.content}`)
    .join("\n\n");
  const prompt = `Resuma em até 150 palavras o seguinte diálogo entre um usuário e um agente de conhecimento. Foque nos tópicos principais discutidos e nas conclusões alcançadas:\n\n${transcript}\n\nResumo:`;
  let summary = "";
  for await (const { chunk } of generateAnswerStream(prompt)) {
    summary += chunk;
  }
  return summary.trim();
}

export async function createMemoryEpisode(
  conversationId: string,
  sector: string,
): Promise<EpisodeRecord | null> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  if (messages.length < 5) return null;

  const summary = await summarizeConversation(
    messages.map((m) => ({ role: m.role, content: m.content })),
  );
  const embedding = await getEmbedding(summary);
  const qdrantPointId = randomUUID();

  await ensureMemoryCollection(sector);

  const episode = await prisma.memoryEpisode.create({
    data: { conversationId, sector, summary, qdrantPointId },
  });

  const client = getQdrantClient();
  await client.upsert(memoryCollectionName(sector), {
    wait: true,
    points: [
      {
        id: qdrantPointId,
        vector: embedding,
        payload: {
          episodeId: episode.id,
          sector,
          conversationId,
          createdAt: episode.createdAt.toISOString(),
          reviewStatus: "pending",
        },
      },
    ],
  });

  return episode;
}

export async function retrieveRelevantEpisodes(
  sector: string,
  question: string,
  options: { topK: number } = { topK: 3 },
): Promise<EpisodeRecord[]> {
  try {
    const client = getQdrantClient();
    const name = memoryCollectionName(sector);

    await client.getCollection(name);

    const embedding = await getEmbedding(question);
    const results = await client.search(name, {
      vector: embedding,
      limit: options.topK,
      filter: {
        must: [{ key: "reviewStatus", match: { value: "approved" } }],
      },
      with_payload: true,
    });

    if (results.length === 0) return [];

    const ids = results
      .map((r) => (r.payload as { episodeId?: string })?.episodeId)
      .filter((id): id is string => Boolean(id));

    const episodes = await prisma.memoryEpisode.findMany({
      where: { id: { in: ids }, reviewStatus: "approved" },
    });

    return episodes;
  } catch {
    return [];
  }
}

export function buildEpisodesBlock(episodes: EpisodeRecord[]): string {
  if (episodes.length === 0) return "";
  const lines = [
    "--- MEMÓRIA DE CONVERSAS ANTERIORES ---",
    "As seguintes conversas passadas são relevantes para a pergunta atual:",
    "",
    ...episodes.map(
      (e, i) =>
        `[Conversa ${i + 1} — ${new Date(e.createdAt).toLocaleDateString("pt-BR")}]\n${e.summary}`,
    ),
    "--- FIM DA MEMÓRIA ---",
  ];
  return lines.join("\n");
}
