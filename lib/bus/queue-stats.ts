import { appConfig } from "@/lib/config";

export type ChatQueueStats = {
  /** Total messages in the queue (ready + unacknowledged) at sample time. */
  depth: number;
  /** Messages ready (not yet delivered to a consumer). */
  ready: number;
  /** Messages currently being processed by consumers. */
  unacked: number;
};

function basicAuthFromAmqpUrl(amqpUrl: string): string | null {
  try {
    const u = new URL(amqpUrl);
    if (!u.username) return null;
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    return Buffer.from(`${user}:${pass}`).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Best-effort snapshot of a RabbitMQ queue depth via the Management HTTP API.
 * Returns null on ANY failure (Management API down, auth missing, parse error,
 * timeout) so callers can degrade to a plain textual status. Never throws.
 * See docs/allByQueue.md §11.6.
 */
export async function getChatQueueStats(
  queueName = "chat.requests",
): Promise<ChatQueueStats | null> {
  try {
    const auth = basicAuthFromAmqpUrl(appConfig.rabbitmqUrl);
    if (!auth) return null;

    const base = appConfig.rabbitmqManagementUrl.replace(/\/$/, "");
    const url = `${base}/api/queues/%2F/${encodeURIComponent(queueName)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      messages?: number;
      messages_ready?: number;
      messages_unacknowledged?: number;
    };

    const ready = body.messages_ready ?? 0;
    const unacked = body.messages_unacknowledged ?? 0;
    const depth = body.messages ?? ready + unacked;
    return { depth, ready, unacked };
  } catch {
    return null;
  }
}
