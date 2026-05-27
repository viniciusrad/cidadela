import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { getEffectiveAgent, getEffectiveProtocols } from "@/lib/agents/effective";
import { listOllamaModels } from "@/lib/ollama";
import { SECTORS } from "@/lib/domain";
import { listDynamicSectors } from "@/lib/sectors/sector-repo";
import { countSectorDocuments } from "@/lib/qdrant";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const allSectors = [...SECTORS];
  const [agents, protocols, dynamicSectors] = await Promise.all([
    Promise.all(SECTORS.map((sector) => getEffectiveAgent(sector))),
    getEffectiveProtocols(),
    listDynamicSectors(),
  ]);

  const dynamicSlugs = dynamicSectors.map((d) => d.slug);
  const allSlugs = [...allSectors, ...dynamicSlugs];

  const docCounts = await Promise.all(
    allSlugs.map(async (slug) => {
      const counts = await countSectorDocuments(slug);
      return { slug, ...counts };
    }),
  );
  const docCountMap = new Map(docCounts.map((d) => [d.slug, d]));

  let availableModels: string[] = [];
  try {
    availableModels = await listOllamaModels();
  } catch {
    availableModels = [];
  }

  const nativeAgents = agents.map((agent) => {
    const counts = docCountMap.get(agent.sector);
    return {
      sector: agent.sector,
      persona: agent.persona,
      params: agent.params,
      defaults: {
        persona: agent.defaults.persona,
        chatModel: agent.defaults.chatModel,
        topK: agent.defaults.topK,
        localConfidenceThreshold: agent.defaults.localConfidenceThreshold,
      },
      hasOverride: agent.override !== null,
      updatedAt: agent.override?.updatedAt ?? null,
      updatedBy: agent.override?.updatedBy ?? null,
      isNative: true,
      isDynamic: false,
      docStats: {
        publicChunks: counts?.publicChunks ?? 0,
        stagingChunks: counts?.stagingChunks ?? 0,
      },
    };
  });

  const dynamicAgents = dynamicSectors.map((def) => {
    const counts = docCountMap.get(def.slug);
    return {
      sector: def.slug,
      persona: {
        name: def.agentName,
        summary: def.agentSummary,
        instructions: def.agentInstructions,
        capabilities: Array.isArray(def.capabilities) ? def.capabilities : [],
      },
      params: {
        chatModel: def.chatModel,
        topK: def.topK ?? 5,
        localConfidenceThreshold: def.localConfidenceThreshold ?? 0.45,
      },
      defaults: {
        persona: {
          name: def.agentName,
          summary: def.agentSummary,
          instructions: def.agentInstructions,
          capabilities: Array.isArray(def.capabilities) ? def.capabilities : [],
        },
        chatModel: def.chatModel,
        topK: def.topK ?? 5,
        localConfidenceThreshold: def.localConfidenceThreshold ?? 0.45,
      },
      hasOverride: false,
      updatedAt: def.updatedAt,
      updatedBy: def.createdBy,
      isNative: false,
      isDynamic: true,
      displayName: def.displayName,
      description: def.description,
      provisionedAt: def.provisionedAt,
      qdrantCollection: def.qdrantCollection,
      qdrantStagingCollection: def.qdrantStagingCollection,
      docStats: {
        publicChunks: counts?.publicChunks ?? 0,
        stagingChunks: counts?.stagingChunks ?? 0,
      },
    };
  });

  return Response.json({
    agents: [...nativeAgents, ...dynamicAgents],
    protocols: protocols.map((protocol) => ({
      id: protocol.id,
      from: protocol.from,
      to: protocol.to,
      intent: protocol.intent,
      template: protocol.template,
      maxTokens: protocol.maxTokens,
      enabled: protocol.enabled,
    })),
    availableModels,
  });
}

