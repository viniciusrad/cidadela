import type { Prisma } from "@prisma/client";

import { createAuditEvent } from "@/lib/db/audit-repo";
import { createBusChannel } from "@/lib/bus/connection";

const AUDIT_QUEUE = "audit.log";
const AUDIT_EXCHANGE = "audit.fanout";

export async function startAuditConsumer() {
  const channel = await createBusChannel();
  await channel.assertExchange(AUDIT_EXCHANGE, "fanout", { durable: true });
  await channel.assertQueue(AUDIT_QUEUE, { durable: true });
  await channel.bindQueue(AUDIT_QUEUE, AUDIT_EXCHANGE, "");
  await channel.prefetch(10);

  await channel.consume(AUDIT_QUEUE, async (message) => {
    if (!message) {
      return;
    }

    try {
      const payload = JSON.parse(message.content.toString()) as {
        traceId: string;
        actorType: string;
        actorId: string;
        targetType: string;
        targetId: string;
        eventType: string;
        payload?: Record<string, unknown>;
      };

      await createAuditEvent({
        ...payload,
        payload: payload.payload as Prisma.InputJsonValue | undefined,
      });
      channel.ack(message);
    } catch {
      channel.ack(message);
    }
  });
}
