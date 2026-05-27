import type { Channel, ConsumeMessage } from "amqplib";

import { answerAgentInternally } from "@/lib/agents/base-agent";
import type { AgentRpcPayload } from "@/lib/agents/types";
import { safePublishAuditEvent } from "@/lib/bus/publisher";
import { createBusChannel } from "@/lib/bus/connection";

const DIRECT_EXCHANGE = "agents.direct";

function queueNameForSector(sector: string) {
  return `agent.${sector}`;
}

async function handleSectorMessage(channel: Channel, message: ConsumeMessage) {
  const payload = JSON.parse(message.content.toString()) as AgentRpcPayload;
  const startedAt = Date.now();

  try {
    const response = await answerAgentInternally(payload);

    if (message.properties.replyTo) {
      channel.sendToQueue(
        message.properties.replyTo,
        Buffer.from(
          JSON.stringify({
            answer: response.answer,
            citations: response.citations,
            status: response.status,
          }),
        ),
        {
          correlationId: message.properties.correlationId,
          contentType: "application/json",
        },
      );
    }

    await safePublishAuditEvent({
      traceId: payload.parentTraceId ?? payload.traceId,
      actorType: "agent",
      actorId: payload.toAgent,
      targetType: "agent",
      targetId: payload.fromAgent,
      eventType: "delegation.fulfilled",
      payload: {
        intent: payload.intent,
        protocol: payload.protocol,
        latencyMs: Date.now() - startedAt,
      },
    });

    channel.ack(message);
  } catch (error) {
    if (message.properties.replyTo) {
      channel.sendToQueue(
        message.properties.replyTo,
        Buffer.from(
          JSON.stringify({
            answer:
              "Nao foi possivel responder a consulta intersetorial neste momento.",
            citations: [],
            status: "protocol_violation",
          }),
        ),
        {
          correlationId: message.properties.correlationId,
          contentType: "application/json",
        },
      );
    }

    await safePublishAuditEvent({
      traceId: payload.parentTraceId ?? payload.traceId,
      actorType: "agent",
      actorId: payload.toAgent,
      targetType: "agent",
      targetId: payload.fromAgent,
      eventType: "delegation.failed",
      payload: {
        intent: payload.intent,
        protocol: payload.protocol,
        message:
          error instanceof Error ? error.message : "Falha no consumer do agente.",
      },
    });

    channel.ack(message);
  }
}

export async function startSectorConsumer(sector: string) {
  const channel = await createBusChannel();
  await channel.assertExchange(DIRECT_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(queueNameForSector(sector), { durable: true });
  await channel.bindQueue(
    queueNameForSector(sector),
    DIRECT_EXCHANGE,
    queueNameForSector(sector),
  );
  await channel.prefetch(1);
  await channel.consume(queueNameForSector(sector), async (message) => {
    if (!message) {
      return;
    }

    await handleSectorMessage(channel, message);
  });
}
