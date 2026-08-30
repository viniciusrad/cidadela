import { syncProtocols } from "@/lib/db/audit-repo";
import { PROTOCOLS } from "@/lib/agents/protocols";
import { ensureAllSectorCollections } from "@/lib/qdrant";
import { appConfig } from "@/lib/config";
import { SECTORS } from "@/lib/domain";
import { syncShareableKnowledgeCapabilities } from "@/lib/knowledge/capabilities";
import { startAuditConsumer } from "@/lib/bus/audit-consumer";
import { startChatConsumer } from "@/lib/bus/chat-queue";
import { startSectorConsumer } from "@/lib/bus/consumer";
import { startMemoryEpisodeConsumer } from "@/lib/bus/consumers/memory-episode.consumer";
import { createBusChannel } from "@/lib/bus/connection";
import { ensureBusTopology } from "@/lib/bus/publisher";

const globalForBootstrap = globalThis as typeof globalThis & {
  __cidadelaBusBootstrap?: Promise<void>;
};

async function bootstrap() {
  if (!appConfig.busBootstrapEnabled) {
    return;
  }

  const channel = await createBusChannel();
  await ensureBusTopology(channel);
  await channel.close();
  await ensureAllSectorCollections();
  await syncProtocols(
    PROTOCOLS.map((protocol) => ({
      fromSector: protocol.from,
      toSector: protocol.to,
      intent: protocol.intent,
      template: protocol.template,
      maxTokens: protocol.maxTokens,
      enabled: protocol.enabled,
    })),
  );
  await syncShareableKnowledgeCapabilities();
  
  const { listAllSectorSlugs } = await import("@/lib/sectors/sector-repo");
  const slugs = await listAllSectorSlugs();
  
  await Promise.all([
    startAuditConsumer(),
    startMemoryEpisodeConsumer(),
    ...slugs.map((sector) => startSectorConsumer(sector)),
  ]);

  if (appConfig.chatQueueEnabled && !appConfig.chatWorkerExternal) {
    await startChatConsumer();
  }
}

export async function ensureBusBootstrapped() {
  if (!globalForBootstrap.__cidadelaBusBootstrap) {
    globalForBootstrap.__cidadelaBusBootstrap = bootstrap().catch((error) => {
      globalForBootstrap.__cidadelaBusBootstrap = undefined;
      throw error;
    });
  }

  return globalForBootstrap.__cidadelaBusBootstrap;
}
