import type { Channel, ConsumeMessage } from "amqplib";

import { runSectorAgent } from "@/lib/agents/base-agent";
import type { ChatJob, ChatStreamEvent } from "@/lib/agents/types";
import { createBusChannel } from "@/lib/bus/connection";
import { appConfig } from "@/lib/config";

const CHAT_EXCHANGE = "chat.direct";
const CHAT_QUEUE = "chat.requests";

/**
 * Idempotently asserts the dedicated chat topology. The `chat.direct` exchange
 * is deliberately separate from `agents.direct` (see docs/allByQueue.md §11.2)
 * so chat traffic never contends with inter-agent RPC queues. Called from both
 * the producer and the consumer.
 */
async function ensureChatTopology(channel: Channel) {
  await channel.assertExchange(CHAT_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(CHAT_QUEUE, { durable: true });
  await channel.bindQueue(CHAT_QUEUE, CHAT_EXCHANGE, CHAT_QUEUE);
}

/**
 * Producer side: enqueues a chat job and streams every `ChatStreamEvent` back
 * through `onEvent`. Resolves once the terminal `done`/`error` event arrives
 * (forwarded to `onEvent` first) or rejects on timeout / parse failure.
 */
export async function enqueueChatJob(
  job: ChatJob,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const channel = await createBusChannel();
  await ensureChatTopology(channel);

  const replyQueue = await channel.assertQueue("", {
    exclusive: true,
    autoDelete: true,
  });

  return await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void channel.close().catch(() => undefined);
      reject(
        new Error("Tempo de espera na fila de chat excedido. Tente novamente."),
      );
    }, appConfig.chatQueueTimeoutMs);

    void channel.consume(
      replyQueue.queue,
      (message) => {
        if (!message || message.properties.correlationId !== job.traceId) {
          return;
        }

        try {
          const event = JSON.parse(
            message.content.toString(),
          ) as ChatStreamEvent;
          onEvent(event);

          if (event.type === "done" || event.type === "error") {
            clearTimeout(timeout);
            resolve();
            void channel.close().catch(() => undefined);
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
          void channel.close().catch(() => undefined);
        }
      },
      { noAck: true },
    );

    channel.publish(
      CHAT_EXCHANGE,
      CHAT_QUEUE,
      Buffer.from(JSON.stringify(job)),
      {
        correlationId: job.traceId,
        replyTo: replyQueue.queue,
        expiration: String(appConfig.chatQueueTimeoutMs),
        contentType: "application/json",
      },
    );
  });
}

async function handleChatJob(channel: Channel, message: ConsumeMessage) {
  const job = JSON.parse(message.content.toString()) as ChatJob;
  const replyTo = message.properties.replyTo;
  const correlationId = message.properties.correlationId;

  let buffer = "";
  let timer: NodeJS.Timeout | null = null;

  const publish = (event: ChatStreamEvent) => {
    if (!replyTo) {
      return;
    }
    channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(event)), {
      correlationId,
      contentType: "application/json",
    });
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer) {
      const chunk = buffer;
      buffer = "";
      publish({ type: "message", data: { chunk } });
    }
  };

  const emit = (event: ChatStreamEvent) => {
    if (event.type === "message") {
      buffer += event.data.chunk;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          flush();
        }, appConfig.chatQueueChunkFlushMs);
      }
      return;
    }
    // Flush pending chunks before any non-message event to preserve ordering —
    // including the terminal `done`/`error` that `runSectorAgent` emits.
    flush();
    publish(event);
  };

  try {
    await runSectorAgent({ ...job, emit });
    // `runSectorAgent` emits its own terminal `done`; this flush is a safety
    // no-op in case any trailing chunk remained buffered.
    flush();
  } catch (error) {
    flush();
    publish({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Falha ao gerar a resposta na fila de chat.",
    });
  } finally {
    channel.ack(message);
  }
}

/**
 * Consumer side: drains `chat.requests`, running `runSectorAgent` per job and
 * streaming its events back to the per-request reply queue.
 */
export async function startChatConsumer(): Promise<void> {
  const channel = await createBusChannel();
  await ensureChatTopology(channel);

  // Global backpressure knob. `chat.requests` is intentionally separate from
  // the `agent.<sector>` queues so chat workers never wait on a chat-worker
  // slot → no deadlock (see docs/allByQueue.md §5.1/§7.2).
  await channel.prefetch(appConfig.chatQueueConcurrency);

  await channel.consume("chat.requests", async (message) => {
    if (!message) {
      return;
    }
    await handleChatJob(channel, message);
  });
}
