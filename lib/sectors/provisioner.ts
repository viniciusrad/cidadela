import { ensureCollection } from "@/lib/qdrant";
import { createBusChannel } from "@/lib/bus/connection";
import { getSectorDefinition, markSectorProvisioned } from "@/lib/sectors/sector-repo";
import { provisionAccessRules } from "@/lib/sectors/access-rules";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProvisionStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
};

export type ProvisionResult = {
  success: boolean;
  steps: ProvisionStep[];
  error?: string;
};

// ─── Provisioning ─────────────────────────────────────────────────────────────

export async function provisionSectorResources(
  slug: string,
): Promise<ProvisionResult> {
  const def = await getSectorDefinition(slug);
  if (!def) {
    return {
      success: false,
      steps: [],
      error: `Setor "${slug}" nao encontrado.`,
    };
  }

  const steps: ProvisionStep[] = [
    { id: "qdrant-prod", label: `Qdrant: ${def.qdrantCollection}`, status: "pending" },
    { id: "qdrant-staging", label: `Qdrant: ${def.qdrantStagingCollection}`, status: "pending" },
    { id: "rabbitmq", label: `RabbitMQ: agent.${slug}`, status: "pending" },
    { id: "access-rules", label: "Regras de acesso", status: "pending" },
    { id: "neo4j", label: "Neo4j: pronto", status: "pending" },
    { id: "finalize", label: "Finalizacao", status: "pending" },
  ];

  function markStep(id: string, status: ProvisionStep["status"], detail?: string) {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
  }

  try {
    // 1. Qdrant production collection
    markStep("qdrant-prod", "running");
    await ensureCollection(def.qdrantCollection);
    markStep("qdrant-prod", "done", `Collection "${def.qdrantCollection}" criada`);

    // 2. Qdrant staging collection
    markStep("qdrant-staging", "running");
    await ensureCollection(def.qdrantStagingCollection);
    markStep("qdrant-staging", "done", `Collection "${def.qdrantStagingCollection}" criada`);

    // 3. RabbitMQ queue
    markStep("rabbitmq", "running");
    await provisionBusQueue(slug);
    markStep("rabbitmq", "done", `Fila "agent.${slug}" vinculada`);

    // 4. Access rules (bidirectional with all existing sectors)
    markStep("access-rules", "running");
    const rulesCount = await provisionAccessRules(slug);
    markStep("access-rules", "done", `${rulesCount} regras criadas`);

    // 5. Neo4j needs no provisioning — documents will use sector property
    markStep("neo4j", "done", "Documentos identificados por propriedade sector");

    // 6. Finalize
    markStep("finalize", "running");
    await markSectorProvisioned(slug);
    markStep("finalize", "done", "Setor provisionado com sucesso");

    return { success: true, steps };
  } catch (error) {
    const failedStep = steps.find((s) => s.status === "running");
    if (failedStep) {
      failedStep.status = "error";
      failedStep.detail = error instanceof Error ? error.message : "Erro desconhecido";
    }
    return {
      success: false,
      steps,
      error: error instanceof Error ? error.message : "Erro no provisionamento",
    };
  }
}

// ─── Bus Queue ────────────────────────────────────────────────────────────────

const DIRECT_EXCHANGE = "agents.direct";

async function provisionBusQueue(slug: string): Promise<void> {
  const channel = await createBusChannel();
  try {
    const queueName = `agent.${slug}`;
    await channel.assertExchange(DIRECT_EXCHANGE, "direct", { durable: true });
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, DIRECT_EXCHANGE, queueName);
  } finally {
    await channel.close();
  }
}
