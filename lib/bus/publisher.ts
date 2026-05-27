import type { Channel } from "amqplib";
import type { Prisma } from "@prisma/client";

import type { AgentRpcPayload } from "@/lib/agents/types";
import { appConfig } from "@/lib/config";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { SECTORS, type ChatCitation } from "@/lib/domain";
import { createBusChannel } from "@/lib/bus/connection";

const DIRECT_EXCHANGE = "agents.direct";
const AUDIT_EXCHANGE = "audit.fanout";

export async function ensureBusTopology(channel: Channel) {
  await channel.assertExchange(DIRECT_EXCHANGE, "direct", { durable: true });
  await channel.assertExchange(AUDIT_EXCHANGE, "fanout", { durable: true });
  
  const { listAllSectorSlugs } = await import("@/lib/sectors/sector-repo");
  const slugs = await listAllSectorSlugs();
  
  for (const sector of slugs) {
    const queueName = `agent.${sector}`;
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, DIRECT_EXCHANGE, queueName);
  }
  await channel.assertQueue("audit.log", { durable: true });
  await channel.bindQueue("audit.log", AUDIT_EXCHANGE, "");
}

export async function requestAgent(payload: AgentRpcPayload) {
  const channel = await createBusChannel();
  await ensureBusTopology(channel);

  const replyQueue = await channel.assertQueue("", {
    exclusive: true,
    autoDelete: true,
  });

  return await new Promise<{
    answer: string;
    citations: ChatCitation[];
    status: "ok" | "protocol_violation";
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void channel.close().catch(() => undefined);
      reject(new Error("RPC timeout na consulta entre agentes."));
    }, appConfig.busRpcTimeoutMs);

    void channel.consume(
      replyQueue.queue,
      async (message) => {
        if (!message || message.properties.correlationId !== payload.traceId) {
          return;
        }

        clearTimeout(timeout);

        try {
          const parsed = JSON.parse(message.content.toString()) as {
            answer: string;
            citations: ChatCitation[];
            status: "ok" | "protocol_violation";
          };
          resolve(parsed);
        } catch (error) {
          reject(error);
        } finally {
          await channel.close().catch(() => undefined);
        }
      },
      { noAck: true },
    );

    channel.publish(
      DIRECT_EXCHANGE,
      `agent.${payload.toAgent}`,
      Buffer.from(JSON.stringify(payload)),
      {
        correlationId: payload.traceId,
        replyTo: replyQueue.queue,
        expiration: String(appConfig.busRpcTimeoutMs),
        contentType: "application/json",
      },
    );
  });
}

export async function publishAuditEvent(payload: {
  traceId: string;
  actorType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const channel = await createBusChannel();
  await ensureBusTopology(channel);
  channel.publish(AUDIT_EXCHANGE, "", Buffer.from(JSON.stringify(payload)), {
    contentType: "application/json",
    persistent: true,
  });
  await channel.close();
}

export async function safePublishAuditEvent(payload: {
  traceId: string;
  actorType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  try {
    await publishAuditEvent(payload);
  } catch {
    await createAuditEvent({
      ...payload,
      payload: payload.payload as Prisma.InputJsonValue | undefined,
    });
  }
}
