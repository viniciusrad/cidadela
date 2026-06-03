import type { Channel, ConsumeMessage } from "amqplib";

import { createBusChannel } from "@/lib/bus/connection";

const DIRECT_EXCHANGE = "agents.direct";
const MEMORY_EPISODE_QUEUE = "memory.episodes";

async function handleMemoryEpisodeMessage(
  channel: Channel,
  message: ConsumeMessage,
) {
  const payload = JSON.parse(message.content.toString()) as {
    conversationId: string;
    sector: string;
  };

  try {
    const { createMemoryEpisode } = await import("@/lib/memory/episodic");
    const result = await createMemoryEpisode(
      payload.conversationId,
      payload.sector,
    );
    console.log(
      `[memory-episode] episódio criado para conversa ${payload.conversationId} (setor: ${payload.sector}):`,
      result,
    );
  } catch (error) {
    console.error(
      `[memory-episode] falha ao criar episódio para conversa ${payload.conversationId}:`,
      error instanceof Error ? error.message : error,
    );
  } finally {
    channel.ack(message);
  }
}

export async function publishMemoryEpisodeJob(
  conversationId: string,
  sector: string,
): Promise<void> {
  const channel = await createBusChannel();
  await channel.assertExchange(DIRECT_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(MEMORY_EPISODE_QUEUE, { durable: true });
  await channel.bindQueue(
    MEMORY_EPISODE_QUEUE,
    DIRECT_EXCHANGE,
    MEMORY_EPISODE_QUEUE,
  );

  channel.publish(
    DIRECT_EXCHANGE,
    MEMORY_EPISODE_QUEUE,
    Buffer.from(JSON.stringify({ conversationId, sector })),
    {
      contentType: "application/json",
      persistent: true,
    },
  );

  await channel.close();
}

export async function startMemoryEpisodeConsumer(): Promise<void> {
  const channel = await createBusChannel();
  await channel.assertExchange(DIRECT_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(MEMORY_EPISODE_QUEUE, { durable: true });
  await channel.bindQueue(
    MEMORY_EPISODE_QUEUE,
    DIRECT_EXCHANGE,
    MEMORY_EPISODE_QUEUE,
  );
  await channel.prefetch(1);

  await channel.consume(MEMORY_EPISODE_QUEUE, async (message) => {
    if (!message) {
      return;
    }
    await handleMemoryEpisodeMessage(channel, message);
  });
}
