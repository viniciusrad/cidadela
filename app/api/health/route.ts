import { prisma } from "@/lib/db/client";
import { createBusChannel } from "@/lib/bus/connection";
import { ensureBusBootstrapped } from "@/lib/bus/bootstrap";
import { checkNeo4jHealth } from "@/lib/neo4j";
import { checkOllamaHealth } from "@/lib/ollama";
import { checkQdrantHealth } from "@/lib/qdrant";

export const runtime = "nodejs";

export async function GET() {
  const checks = await Promise.allSettled([
    checkQdrantHealth(),
    checkOllamaHealth(),
    prisma.$queryRaw`SELECT 1`,
    (async () => {
      await ensureBusBootstrapped().catch(() => undefined);
      const channel = await createBusChannel();
      await channel.close();
      return true;
    })(),
    checkNeo4jHealth(),
  ]);

  const qdrantOk = checks[0].status === "fulfilled";
  const ollamaOk = checks[1].status === "fulfilled";
  const postgresOk = checks[2].status === "fulfilled";
  const rabbitmqOk = checks[3].status === "fulfilled";
  const neo4jOk = checks[4].status === "fulfilled" && checks[4].value;

  return Response.json({
    status:
      qdrantOk && ollamaOk && postgresOk && rabbitmqOk && neo4jOk
        ? "ok"
        : "degraded",
    qdrant: {
      ok: qdrantOk,
      message:
        qdrantOk
          ? "Colecoes vetoriais acessiveis."
          : "Qdrant indisponivel ou sem resposta.",
    },
    ollama: {
      ok: ollamaOk,
      message:
        ollamaOk
          ? "Modelos do Ollama encontrados."
          : "Ollama indisponivel ou sem os modelos esperados.",
    },
    postgres: {
      ok: postgresOk,
      message: postgresOk ? "Postgres conectado." : "Postgres indisponivel.",
    },
    rabbitmq: {
      ok: rabbitmqOk,
      message: rabbitmqOk ? "RabbitMQ conectado." : "RabbitMQ indisponivel.",
    },
    neo4j: {
      ok: neo4jOk,
      message: neo4jOk ? "Neo4j conectado." : "Neo4j indisponivel.",
    },
  });
}
